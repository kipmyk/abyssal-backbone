import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { CableRuntimeState, SubseaCable } from '../types/network';

export type SubseaCameraMode = 'orbit' | 'rov-pov' | 'anatomy';

interface SubseaCameraTransition {
  targetMode: SubseaCameraMode;
  fromPos: THREE.Vector3;
  fromQuat: THREE.Quaternion;
  fromTarget: THREE.Vector3;
  fromFov: number;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  toFov: number;
  elapsed: number;
  duration: number;
}

export class SubseaRovScene {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private orbitCamera: THREE.PerspectiveCamera;
  private rovPovCamera: THREE.PerspectiveCamera;
  private activeCamera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private fog: THREE.FogExp2;

  private ambientLight!: THREE.AmbientLight;
  private sunDownLight!: THREE.DirectionalLight;
  private causticUniforms!: {
    uTime: { value: number };
    uDepthFactor: { value: number };
  };

  private seabedMesh!: THREE.Mesh;
  private marineSnow!: THREE.Points;
  private bubbleParticles!: THREE.Points;
  private bubblePositions!: Float32Array;

  // Intact Cable + Multi-Layer Cutaway Anatomy
  private intactGroup = new THREE.Group();
  private anatomyGroup = new THREE.Group();
  private fiberPulseMeshes: THREE.Mesh[] = [];
  private repeaterLeds: THREE.Mesh[] = [];

  // Severed Cable + Frayed Helical Armor + Electric Arcs
  private severedGroup = new THREE.Group();
  private plasmaArcMesh!: THREE.Mesh;
  private plasmaLight!: THREE.PointLight;

  // Realistic Failure Hazard Models
  private anchorGroup = new THREE.Group();
  private landslideGroup = new THREE.Group();
  private trawlerGroup = new THREE.Group();
  private landslideRocks: THREE.Mesh[] = [];

  // Work-Class ROV & Grapnel Recovery
  private rovGroup = new THREE.Group();
  private rovProps: THREE.Mesh[] = [];
  private rovLeftClaw!: THREE.Group;
  private rovRightClaw!: THREE.Group;
  private rovSpliceArcLight!: THREE.PointLight;

  private cameraMode: SubseaCameraMode = 'orbit';
  private anatomyPeel = 0; // 0 = sealed armored cable, 1 = full 8-layer cutaway
  private currentState: CableRuntimeState | null = null;
  private motionPaused = false;
  private reducedMotion = false;
  private resizeObserver: ResizeObserver;
  private animFrameId = 0;
  private lastTime = performance.now();

  private cameraTransition: SubseaCameraTransition | null = null;
  private rovInitialized = false;
  private readonly rovTargetPos = new THREE.Vector3(0.65, 2.05, 0);
  private readonly rovPrevPos = new THREE.Vector3(0.65, 2.05, 0);
  private readonly rovVelocity = new THREE.Vector3();
  private readonly rovLookTarget = new THREE.Vector3(0, -0.15, 0);
  private readonly rovDesiredFocus = new THREE.Vector3(0, -0.15, 0);
  private readonly rovNoseWorld = new THREE.Vector3();
  private readonly lookAtMatrix = new THREE.Matrix4();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly scratchDelta = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  constructor(container: HTMLElement) {
    this.container = container;
    this.reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020c1b);
    this.fog = new THREE.FogExp2(0x020c1b, 0.036);
    this.scene.fog = this.fog;

    const w = container.clientWidth || 540;
    const h = container.clientHeight || 360;

    this.orbitCamera = new THREE.PerspectiveCamera(44, w / h, 0.08, 120);
    this.orbitCamera.position.set(1.4, 2.8, 7.6);

    this.rovPovCamera = new THREE.PerspectiveCamera(58, w / h, 0.05, 80);
    this.activeCamera = this.orbitCamera;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    const cores = navigator.hardwareConcurrency || 8;
    const mem = (navigator as { deviceMemory?: number }).deviceMemory || 8;
    const startBalanced = cores <= 4 || mem <= 4;
    this.renderer.setPixelRatio(
      startBalanced
        ? Math.min(window.devicePixelRatio, 1.35)
        : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.22;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.orbitCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 0.15, 0);
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.minDistance = 1.6;
    this.controls.maxDistance = 20;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.85;

    this.renderer.domElement.addEventListener('pointerdown', () => {
      if (this.cameraTransition && this.cameraTransition.targetMode !== 'rov-pov') {
        this.cameraTransition = null;
        this.controls.enabled = true;
      }
    });

    this.setupLighting();
    this.buildSeabedWithCaustics();
    this.buildMarineSnowAndElectrolysisBubbles();
    this.buildIntactCableAndRepeater();
    this.buildMultiLayerCableAnatomy();
    this.buildSeveredCableWithHelicalArmor();
    this.buildRealisticHazards();
    this.buildWorkClassRov();
    this.rovGroup.position.copy(this.rovTargetPos);
    this.rovNoseWorld.set(0, -0.12, 0.72).add(this.rovTargetPos);

    this.scene.add(this.intactGroup);
    this.scene.add(this.anatomyGroup);
    this.scene.add(this.severedGroup);
    this.scene.add(this.anchorGroup);
    this.scene.add(this.landslideGroup);
    this.scene.add(this.trawlerGroup);
    this.scene.add(this.rovGroup);

    this.anatomyGroup.visible = false;

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.animate();
  }

  public setMotionPaused(paused: boolean): void {
    this.motionPaused = paused;
  }

  public setQualityTier(tier: 'high' | 'balanced' | 'eco'): void {
    const dprCap = tier === 'high' ? 2 : tier === 'balanced' ? 1.35 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.renderer.shadowMap.enabled = tier !== 'eco';
    const snowTotal = this.marineSnow.geometry.getAttribute('position').count;
    const visibleRatio = tier === 'high' ? 1 : tier === 'balanced' ? 0.6 : 0.3;
    this.marineSnow.geometry.setDrawRange(
      0,
      Math.max(20, Math.round(snowTotal * visibleRatio))
    );
    this.handleResize();
  }

  public setCameraMode(mode: SubseaCameraMode): void {
    const prevMode = this.cameraMode;
    this.cameraMode = mode;

    const fromPos = this.activeCamera.position.clone();
    const fromQuat = this.activeCamera.quaternion.clone();
    const fromTarget =
      prevMode === 'rov-pov'
        ? this.rovLookTarget.clone()
        : this.controls.target.clone();
    const fromFov = this.activeCamera.fov;

    let toPos: THREE.Vector3;
    let toTarget: THREE.Vector3;
    let toFov: number;

    if (mode === 'rov-pov') {
      this.activeCamera = this.rovPovCamera;
      this.controls.enabled = false;
      this.rovPovCamera.position.copy(fromPos);
      this.rovPovCamera.quaternion.copy(fromQuat);
      this.rovPovCamera.fov = fromFov;
      this.rovPovCamera.updateProjectionMatrix();

      toPos = this.rovNoseWorld.clone();
      toTarget = this.rovLookTarget.clone();
      toFov = this.currentState?.cutState === 'repairing' ? 53 : 58;
    } else {
      this.activeCamera = this.orbitCamera;
      this.controls.enabled = false;
      this.orbitCamera.position.copy(fromPos);
      this.orbitCamera.quaternion.copy(fromQuat);
      this.orbitCamera.fov = fromFov;
      this.orbitCamera.updateProjectionMatrix();

      if (mode === 'anatomy') {
        toPos = new THREE.Vector3(0.4, 1.15, 3.1);
        toTarget = new THREE.Vector3(0, 0.05, 0);
        toFov = 42;
        this.setAnatomyPeel(1);
      } else {
        toPos = new THREE.Vector3(1.4, 2.8, 7.6);
        toTarget = new THREE.Vector3(0, 0.15, 0);
        toFov = 44;
        this.setAnatomyPeel(0);
      }
    }

    this.cameraTransition = {
      targetMode: mode,
      fromPos,
      fromQuat,
      fromTarget,
      fromFov,
      toPos,
      toTarget,
      toFov,
      elapsed: 0,
      duration: this.reducedMotion ? 0.18 : 0.88,
    };

    this.syncVisibility();
  }

  public setAnatomyPeel(peel: number): void {
    this.anatomyPeel = peel;
    this.syncVisibility();
  }

  public updateInspection(cable: SubseaCable, state: CableRuntimeState): void {
    this.currentState = state;

    const absDepth = Math.abs(state.faultDepthM ?? cable.depthMaxM ?? 2200);
    // Photic zone (<250m) vs Bathypelagic (1000-4000m) vs Abyssal (>4000m)
    const depthNorm = Math.min(1, absDepth / 5200);
    const bgCol = new THREE.Color().setHSL(
      0.55 + depthNorm * 0.04,
      0.82,
      THREE.MathUtils.lerp(0.16, 0.02, depthNorm)
    );
    this.scene.background = bgCol;
    this.fog.color.copy(bgCol);
    this.fog.density = THREE.MathUtils.lerp(0.025, 0.048, depthNorm);

    this.causticUniforms.uDepthFactor.value = Math.max(
      0.08,
      1.0 - Math.min(1, absDepth / 1400)
    );
    this.ambientLight.intensity = THREE.MathUtils.lerp(1.25, 0.38, depthNorm);
    this.sunDownLight.intensity = THREE.MathUtils.lerp(1.9, 0.45, depthNorm);

    const ledColor =
      state.cutState === 'active'
        ? 0x10b981
        : state.cutState === 'repairing'
        ? 0xf59e0b
        : 0xef4444;
    for (const led of this.repeaterLeds) {
      (led.material as THREE.MeshBasicMaterial).color.setHex(ledColor);
    }

    this.syncVisibility();
  }

  private syncVisibility(): void {
    const state = this.currentState;
    if (!state) return;

    const isActive = state.cutState === 'active';
    const showAnatomy = this.anatomyPeel > 0.1 || this.cameraMode === 'anatomy';

    this.anatomyGroup.visible = showAnatomy;
    this.intactGroup.visible = !showAnatomy && isActive;
    this.severedGroup.visible = !showAnatomy && !isActive;

    const cause = state.faultCause ?? 'Anchor Drag';
    this.anchorGroup.visible = !showAnatomy && !isActive && cause === 'Anchor Drag';
    this.landslideGroup.visible =
      !showAnatomy && !isActive && cause === 'Turbidity Landslide';
    this.trawlerGroup.visible =
      !showAnatomy && !isActive && cause === 'Trawler Snag';

    this.bubbleParticles.visible = !showAnatomy && !isActive;
    // Keep ROV active in patrol/inspection or repair posture whenever not in cutaway anatomy mode
    this.rovGroup.visible = !showAnatomy || this.cameraMode === 'rov-pov';
  }

  private setupLighting(): void {
    this.ambientLight = new THREE.AmbientLight(0x38bdf8, 0.75);
    this.scene.add(this.ambientLight);

    this.sunDownLight = new THREE.DirectionalLight(0xbae6fd, 1.3);
    this.sunDownLight.position.set(5, 18, 7);
    this.sunDownLight.castShadow = true;
    this.sunDownLight.shadow.mapSize.width = 1024;
    this.sunDownLight.shadow.mapSize.height = 1024;
    this.scene.add(this.sunDownLight);

    const rimLight = new THREE.PointLight(0x0ea5e9, 1.8, 22);
    rimLight.position.set(-5, 3.5, -4);
    this.scene.add(rimLight);
  }

  /**
   * Builds a detailed 3D ocean floor with basalt outcrops, ploughed cable trench,
   * ripple marks, and a custom GLSL underwater Voronoi caustic projection shader.
   */
  private buildSeabedWithCaustics(): void {
    const geo = new THREE.PlaneGeometry(44, 30, 128, 88);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      const canyonWall = Math.pow(Math.abs(z) / 13.5, 2.2) * 2.9;
      const ripples =
        Math.sin(x * 1.7 + z * 0.9) * 0.12 +
        Math.cos(x * 4.2 - z * 3.1) * 0.045 +
        Math.sin(x * 0.45) * 0.18;
      // Ploughed cable burial trench along z = 0
      const trench = Math.exp(-(z * z) / 0.85) * -0.24;
      // Raised berm shoulders beside the ploughed trench
      const berm =
        (Math.exp(-Math.pow(z - 1.1, 2) / 0.4) +
          Math.exp(-Math.pow(z + 1.1, 2) / 0.4)) *
        0.11;
      // Anchor drag scar across x = 0
      const anchorScar =
        Math.exp(-(x * x) / 0.55) * Math.exp(-(z * z) / 18) * -0.19;

      pos.setY(i, canyonWall + ripples + trench + berm + anchorScar - 0.36);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    this.causticUniforms = {
      uTime: { value: 0 },
      uDepthFactor: { value: 0.65 },
    };

    const mat = new THREE.MeshStandardMaterial({
      color: 0x162c42,
      roughness: 0.86,
      metalness: 0.08,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.causticUniforms.uTime;
      shader.uniforms.uDepthFactor = this.causticUniforms.uDepthFactor;
      shader.vertexShader =
        `varying vec3 vWorldPos;\n` +
        shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
      shader.fragmentShader =
        `uniform float uTime;\nuniform float uDepthFactor;\nvarying vec3 vWorldPos;\n` +
        shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
          // Underwater refractive caustic lattice + sonar range rings
          vec2 uvC = vWorldPos.xz * 0.65;
          float c1 = sin(uvC.x * 3.2 + uTime * 1.6 + cos(uvC.y * 2.7 - uTime * 1.2));
          float c2 = cos(uvC.y * 3.8 - uTime * 1.4 + sin(uvC.x * 2.9 + uTime * 1.1));
          float caustic = pow(max(0.0, c1 * c2), 3.0) * 0.42 * uDepthFactor;
          float distRing = abs(fract(length(vWorldPos.xz) * 0.25 - uTime * 0.15) - 0.5);
          float sonarLine = smoothstep(0.02, 0.0, distRing) * 0.08;
          gl_FragColor.rgb += vec3(0.08, 0.52, 0.78) * (caustic + sonarLine);
          #include <dithering_fragment>
          `
        );
    };

    this.seabedMesh = new THREE.Mesh(geo, mat);
    this.seabedMesh.receiveShadow = true;
    this.scene.add(this.seabedMesh);
  }

  private buildMarineSnowAndElectrolysisBubbles(): void {
    // 1. Marine snow & suspended silt
    const snowCount = 850;
    const snowPos = new Float32Array(snowCount * 3);
    for (let i = 0; i < snowCount; i++) {
      snowPos[i * 3] = (Math.random() - 0.5) * 26;
      snowPos[i * 3 + 1] = Math.random() * 10 - 0.3;
      snowPos[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
    this.marineSnow = new THREE.Points(
      snowGeo,
      new THREE.PointsMaterial({
        color: 0xbae6fd,
        size: 0.055,
        transparent: true,
        opacity: 0.5,
      })
    );
    this.scene.add(this.marineSnow);

    // 2. Rising electrolysis gas bubbles from ruptured PFE copper conductor at cut point
    const bCount = 160;
    this.bubblePositions = new Float32Array(bCount * 3);
    for (let i = 0; i < bCount; i++) {
      this.bubblePositions[i * 3] = (Math.random() - 0.5) * 1.4;
      this.bubblePositions[i * 3 + 1] = Math.random() * 4.5;
      this.bubblePositions[i * 3 + 2] = (Math.random() - 0.5) * 0.7;
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.bubblePositions, 3)
    );
    this.bubbleParticles = new THREE.Points(
      bGeo,
      new THREE.PointsMaterial({
        color: 0x7dd3fc,
        size: 0.08,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
      })
    );
    this.scene.add(this.bubbleParticles);
  }

  /**
   * Builds a realistic Beryllium-Copper Subsea Optical Repeater Housing
   * with machined heat-dissipation ribs, gimbal joints, and articulated vertebral bend restrictors.
   */
  private createDetailedRepeater(xCenter: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(xCenter, -0.14, 0);

    const beCuMat = new THREE.MeshStandardMaterial({
      color: 0xc2782b,
      metalness: 0.84,
      roughness: 0.24,
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.75,
      roughness: 0.35,
    });
    const polyMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.2,
    });

    // Main cylindrical pressure vessel (tested to 80 MPa / 8000m)
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 2.1, 24).rotateZ(Math.PI / 2),
      beCuMat
    );
    barrel.castShadow = true;
    g.add(barrel);

    // Machined circumferential pressure & cooling ribs
    const ribGeo = new THREE.TorusGeometry(0.33, 0.025, 10, 24).rotateY(
      Math.PI / 2
    );
    for (const rx of [-0.85, -0.45, 0.45, 0.85]) {
      const rib = new THREE.Mesh(ribGeo, darkSteelMat);
      rib.position.x = rx;
      g.add(rib);
    }

    // Glowing optical / PFE status telemetry rings
    const ledGeo = new THREE.TorusGeometry(0.335, 0.018, 8, 24).rotateY(
      Math.PI / 2
    );
    for (const lx of [-0.18, 0.18]) {
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
      const led = new THREE.Mesh(ledGeo, ledMat);
      led.position.x = lx;
      g.add(led);
      this.repeaterLeds.push(led);
    }

    // Articulated vertebral bend-restrictor boots on both ends (6 interlocking cones each side)
    for (const dir of [-1, 1]) {
      for (let v = 0; v < 6; v++) {
        const radius = 0.26 - v * 0.022;
        const vertebra = new THREE.Mesh(
          new THREE.CylinderGeometry(
            radius * 0.82,
            radius,
            0.22,
            16
          ).rotateZ((dir * Math.PI) / 2),
          v % 2 === 0 ? polyMat : darkSteelMat
        );
        vertebra.position.x = dir * (1.18 + v * 0.22);
        g.add(vertebra);
      }
    }

    return g;
  }

  private buildIntactCableAndRepeater(): void {
    const pts: THREE.Vector3[] = [];
    for (let i = -18; i <= 18; i++) {
      pts.push(
        new THREE.Vector3(
          i,
          -0.2 + Math.sin(i * 0.35) * 0.03,
          Math.sin(i * 0.2) * 0.12
        )
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);

    // Outer armored sheath with translucent cutaway window so internal fiber pulses show
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.7,
      roughness: 0.32,
      transparent: true,
      opacity: 0.76,
    });
    const sheath = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 140, 0.135, 16, false),
      armorMat
    );
    sheath.castShadow = true;
    this.intactGroup.add(sheath);

    // Helical yellow/black submarine hazard serving bands along cable
    const bandGeo = new THREE.TorusGeometry(0.14, 0.015, 8, 16).rotateY(
      Math.PI / 2
    );
    const yellowMat = new THREE.MeshStandardMaterial({
      color: 0xeab308,
      roughness: 0.4,
    });
    for (let u = 0.04; u <= 0.96; u += 0.035) {
      const p = curve.getPointAt(u);
      if (Math.abs(p.x - -3.6) < 2.6) continue; // skip repeater body
      const b = new THREE.Mesh(bandGeo, yellowMat);
      b.position.copy(p);
      this.intactGroup.add(b);
    }

    // Inner C-band DWDM optical fiber core
    const core = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 140, 0.052, 10, false),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    this.intactGroup.add(core);

    // Detailed Beryllium-Copper EDFA Repeater at x = -3.6
    this.intactGroup.add(this.createDetailedRepeater(-3.6));

    // Travelling DWDM laser wavepackets
    const pulseGeo = new THREE.SphereGeometry(0.088, 10, 10);
    const pulseMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(pulseGeo, pulseMat);
      m.userData = { u: i / 10, curve };
      this.intactGroup.add(m);
      this.fiberPulseMeshes.push(m);
    }
  }

  /**
   * Builds a telescopic 7-layer cutaway of a real double-armored submarine optical cable:
   * 1. Outer polypropylene & bitumen serving
   * 2. Helically wound galvanized steel armor wires (16 individual 3D helical rods!)
   * 3. Polycarbonate inner bedding
   * 4. High-Density Polyethylene (HDPE) ±15kV high-voltage insulator
   * 5. Seamless copper PFE power-feeding tube
   * 6. Stainless steel loose tube
   * 7. 12 color-coded silica optical fibers with live laser pulses
   */
  private buildMultiLayerCableAnatomy(): void {
    this.anatomyGroup.position.set(0, 0.35, 0);

    // Layer 1: Outer Bitumen & Polypropylene Yarn Serving (x: -3.2 to -1.6)
    const outerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.46, 0.46, 1.6, 28).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        roughness: 0.75,
        metalness: 0.15,
      })
    );
    outerMesh.position.x = -2.4;
    this.anatomyGroup.add(outerMesh);

    // Yellow subsea warning stripes on outer serving
    for (const sx of [-2.9, -2.4, -1.9]) {
      const stripe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.468, 0.468, 0.14, 28).rotateZ(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 })
      );
      stripe.position.x = sx;
      this.anatomyGroup.add(stripe);
    }

    // Layer 2: 18 Helically Wound Galvanized High-Tensile Steel Armor Wires (x: -1.6 to -0.2)
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.88,
      roughness: 0.22,
    });
    const armorCount = 18;
    for (let a = 0; a < armorCount; a++) {
      const baseAngle = (a / armorCount) * Math.PI * 2;
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        const x = -1.65 + t * 1.55;
        const ang = baseAngle + t * Math.PI * 0.85;
        pts.push(
          new THREE.Vector3(x, Math.cos(ang) * 0.38, Math.sin(ang) * 0.38)
        );
      }
      const wireCurve = new THREE.CatmullRomCurve3(pts);
      this.anatomyGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(wireCurve, 28, 0.048, 8, false),
          steelMat
        )
      );
    }

    // Layer 3: High-Density Polyethylene (HDPE) ±12kV Dielectric Insulator (x: -0.1 to +1.0)
    const hdpeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.31, 0.31, 1.15, 28).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.35,
        metalness: 0.05,
        transparent: true,
        opacity: 0.88,
      })
    );
    hdpeMesh.position.x = 0.45;
    this.anatomyGroup.add(hdpeMesh);

    // Layer 4: Seamless Copper PFE Conductor Tube (±12kV DC feed) (x: +1.0 to +2.0)
    const copperMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 1.05, 28).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0xd97706,
        metalness: 0.92,
        roughness: 0.18,
      })
    );
    copperMesh.position.x = 1.5;
    this.anatomyGroup.add(copperMesh);

    // Layer 5: Stainless Steel Loose Buffer Tube (x: +2.0 to +2.65)
    const bufferMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.7, 24).rotateZ(Math.PI / 2),
      steelMat
    );
    bufferMesh.position.x = 2.32;
    this.anatomyGroup.add(bufferMesh);

    // Layer 6: 12 Individual Color-Coded Silica Optical Fibers (TIA-598 standard colors!) (x: +2.65 to +3.85)
    const tiaColors = [
      0x3b82f6, // Blue
      0xf97316, // Orange
      0x10b981, // Green
      0xb45309, // Brown
      0x94a3b8, // Slate
      0xffffff, // White
      0xef4444, // Red
      0x38bdf8, // Aqua
      0xfacc15, // Yellow
      0xa855f7, // Violet
      0xf43f5e, // Rose
      0x2dd4bf, // Teal
    ];
    for (let f = 0; f < tiaColors.length; f++) {
      const ang = (f / tiaColors.length) * Math.PI * 2;
      const pts = [
        new THREE.Vector3(2.6, Math.cos(ang) * 0.07, Math.sin(ang) * 0.07),
        new THREE.Vector3(3.2, Math.cos(ang) * 0.14, Math.sin(ang) * 0.14),
        new THREE.Vector3(3.85, Math.cos(ang) * 0.2, Math.sin(ang) * 0.2),
      ];
      const fCurve = new THREE.CatmullRomCurve3(pts);
      this.anatomyGroup.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(fCurve, 20, 0.018, 8, false),
          new THREE.MeshBasicMaterial({ color: tiaColors[f] })
        )
      );
    }
  }

  private buildSeveredCableWithHelicalArmor(): void {
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.7,
      roughness: 0.38,
    });
    const copperMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.9,
      roughness: 0.2,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.25,
    });

    // Left recoiled broken trunk
    const leftCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-18, -0.2, 0),
      new THREE.Vector3(-7, -0.2, 0.12),
      new THREE.Vector3(-2.6, -0.15, -0.15),
      new THREE.Vector3(-0.95, 0.18, 0.35),
    ]);
    this.severedGroup.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(leftCurve, 64, 0.135, 16, false),
        armorMat
      )
    );

    // Right recoiled broken trunk
    const rightCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.95, 0.12, -0.35),
      new THREE.Vector3(2.8, -0.16, 0.12),
      new THREE.Vector3(8, -0.2, -0.08),
      new THREE.Vector3(18, -0.2, 0),
    ]);
    this.severedGroup.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(rightCurve, 64, 0.135, 16, false),
        armorMat
      )
    );

    // Exposed copper PFE sleeves & birdcaged helical steel armor strands at both break faces
    for (const side of [-1, 1]) {
      const tipX = side * 0.92;
      const tipY = side === -1 ? 0.18 : 0.12;
      const tipZ = side === -1 ? 0.35 : -0.35;

      const cuStub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 0.32, 16).rotateZ(Math.PI / 2),
        copperMat
      );
      cuStub.position.set(tipX - side * 0.08, tipY, tipZ);
      this.severedGroup.add(cuStub);

      for (let w = 0; w < 14; w++) {
        const a = (w / 14) * Math.PI * 2;
        const splayPts = [
          new THREE.Vector3(
            tipX,
            tipY + Math.cos(a) * 0.1,
            tipZ + Math.sin(a) * 0.1
          ),
          new THREE.Vector3(
            tipX - side * 0.25,
            tipY + Math.cos(a + 0.4) * 0.22,
            tipZ + Math.sin(a + 0.4) * 0.22
          ),
          new THREE.Vector3(
            tipX - side * 0.48,
            tipY + Math.cos(a + 0.8) * 0.28,
            tipZ + Math.sin(a + 0.8) * 0.28
          ),
        ];
        const sCurve = new THREE.CatmullRomCurve3(splayPts);
        this.severedGroup.add(
          new THREE.Mesh(
            new THREE.TubeGeometry(sCurve, 10, 0.015, 6, false),
            steelMat
          )
        );
      }
    }

    // High-voltage PFE sea-earth return plasma arc at the break point
    this.plasmaArcMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.36, 1),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        wireframe: true,
        transparent: true,
        opacity: 0.85,
      })
    );
    this.plasmaArcMesh.position.set(-0.78, 0.18, 0.35);
    this.severedGroup.add(this.plasmaArcMesh);

    this.plasmaLight = new THREE.PointLight(0x38bdf8, 3.2, 6);
    this.plasmaLight.position.copy(this.plasmaArcMesh.position);
    this.severedGroup.add(this.plasmaLight);

    // Repeater housing on left span showing red LOS status rings
    this.severedGroup.add(this.createDetailedRepeater(-4.2));
  }

  private buildRealisticHazards(): void {
    const forgedIronMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.82,
      roughness: 0.32,
    });

    // 1. 15-Ton Stockless Hall Ship Anchor & Stud-Link Chain
    const shank = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 2.7, 0.26),
      forgedIronMat
    );
    shank.position.set(0, 0.88, -0.08);
    shank.rotation.z = -0.32;
    shank.rotation.x = 0.22;
    shank.castShadow = true;
    this.anchorGroup.add(shank);

    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.38, 0.48),
      forgedIronMat
    );
    crown.position.set(-0.35, -0.12, 0.08);
    crown.rotation.z = -0.25;
    this.anchorGroup.add(crown);

    for (const side of [-0.52, 0.52]) {
      const fluke = new THREE.Mesh(
        new THREE.ConeGeometry(0.36, 1.45, 4),
        forgedIronMat
      );
      fluke.position.set(side - 0.15, 0.28, side * 0.25);
      fluke.rotation.z = -0.15;
      fluke.rotation.x = 0.45;
      fluke.castShadow = true;
      this.anchorGroup.add(fluke);
    }

    const linkGeo = new THREE.TorusGeometry(0.18, 0.055, 10, 18);
    for (let i = 0; i < 20; i++) {
      const link = new THREE.Mesh(linkGeo, forgedIronMat);
      link.position.set(0.45 + i * 0.17, 2.0 + i * 0.4, -0.2 - i * 0.12);
      link.rotation.y = (i % 2) * (Math.PI / 2);
      this.anchorGroup.add(link);
    }

    // 2. Subsea Canyon Turbidity Landslide & Falling Basalt Blocks
    const basaltMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.92,
      metalness: 0.05,
    });
    const specs: Array<[number, number, number, number]> = [
      [0.0, 0.22, 0.0, 0.72],
      [-0.62, 0.06, -0.35, 0.5],
      [0.58, 0.12, 0.32, 0.56],
      [0.14, 0.72, -0.2, 0.44],
      [-0.3, 1.35, 0.25, 0.38],
      [0.42, 1.85, -0.3, 0.34],
    ];
    specs.forEach(([x, y, z, r], idx) => {
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(r, 1),
        basaltMat
      );
      rock.position.set(x, y, z);
      rock.userData = { baseY: y, phase: idx * 1.1 };
      rock.castShadow = true;
      this.landslideGroup.add(rock);
      if (idx >= 3) this.landslideRocks.push(rock);
    });

    // 3. Commercial Bottom Trawler Steel Otter Board & Warp Wire
    const otterMat = new THREE.MeshStandardMaterial({
      color: 0xb45309,
      metalness: 0.65,
      roughness: 0.38,
    });
    const otterBoard = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 1.18, 0.14),
      otterMat
    );
    otterBoard.position.set(0, 0.34, 0);
    otterBoard.rotation.set(-0.24, 0.58, 0.12);
    otterBoard.castShadow = true;
    this.trawlerGroup.add(otterBoard);

    const warpWire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 14, 8),
      forgedIronMat
    );
    warpWire.position.set(2.4, 4.8, -2.2);
    warpWire.rotation.set(-0.32, 0, -0.38);
    this.trawlerGroup.add(warpWire);
  }

  private buildWorkClassRov(): void {
    const syntacticYellow = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.32,
      metalness: 0.14,
    });
    const titaniumDark = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.28,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.92,
      roughness: 0.15,
    });

    // Syntactic foam upper buoyancy module with beveled profile
    const buoyancy = new THREE.Mesh(
      new THREE.BoxGeometry(1.95, 0.66, 1.32),
      syntacticYellow
    );
    buoyancy.position.y = 0.58;
    buoyancy.castShadow = true;
    this.rovGroup.add(buoyancy);

    // Lower open work-class structural skid & tooling frame
    const skid = new THREE.Mesh(
      new THREE.BoxGeometry(1.82, 0.58, 1.22),
      titaniumDark
    );
    skid.position.y = 0.0;
    this.rovGroup.add(skid);

    // 4 Kort-nozzle vectored thrusters with spinning blades
    const nozzleGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.26, 16).rotateX(
      Math.PI / 2
    );
    const bladeGeo = new THREE.BoxGeometry(0.3, 0.045, 0.07);
    const bladeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const coords: Array<[number, number, number]> = [
      [-1.02, 0.24, -0.68],
      [1.02, 0.24, -0.68],
      [-1.02, 0.24, 0.68],
      [1.02, 0.24, 0.68],
    ];
    for (const [tx, ty, tz] of coords) {
      const nozzle = new THREE.Mesh(nozzleGeo, titaniumDark);
      nozzle.position.set(tx, ty, tz);
      this.rovGroup.add(nozzle);

      const prop = new THREE.Mesh(bladeGeo, bladeMat);
      prop.position.set(tx, ty, tz);
      this.rovGroup.add(prop);
      this.rovProps.push(prop);
    }

    // Dual 7-function hydraulic manipulator arms + claws
    const buildArm = (side: -1 | 1) => {
      const armGroup = new THREE.Group();
      armGroup.position.set(side * 0.62, -0.22, 0.42);
      const upper = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.048, 0.65, 10),
        titaniumDark
      );
      upper.position.y = -0.28;
      upper.rotation.z = side * 0.28;
      armGroup.add(upper);

      const piston = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.55, 10),
        chromeMat
      );
      piston.position.set(side * -0.14, -0.72, 0.12);
      piston.rotation.z = side * -0.35;
      armGroup.add(piston);
      return armGroup;
    };

    this.rovLeftClaw = buildArm(-1);
    this.rovRightClaw = buildArm(1);
    this.rovGroup.add(this.rovLeftClaw);
    this.rovGroup.add(this.rovRightClaw);

    // Volumetric LED Subsea Light Cones + Real SpotLights
    const coneGeo = new THREE.ConeGeometry(1.4, 3.8, 24, 1, true);
    coneGeo.translate(0, -1.9, 0);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const lx of [-0.54, 0.54]) {
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(lx, 0.22, 0.58);
      cone.rotation.x = -0.28;
      this.rovGroup.add(cone);
    }

    const spot = new THREE.SpotLight(0xe0f2fe, 5.2, 20, Math.PI / 3.8, 0.45);
    spot.position.set(0, 0.55, 0.55);
    spot.target.position.set(0, -2.6, 0.2);
    this.rovGroup.add(spot);
    this.rovGroup.add(spot.target);

    // Armored umbilical tether rising to surface vessel
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 15, 10),
      syntacticYellow
    );
    tether.position.set(0, 8.0, -0.15);
    this.rovGroup.add(tether);

    // Fusion-splicing / electrode arc point light
    this.rovSpliceArcLight = new THREE.PointLight(0x38bdf8, 0, 9);
    this.rovSpliceArcLight.position.set(0, -0.95, 0.2);
    this.rovGroup.add(this.rovSpliceArcLight);
  }

  private handleResize(): void {
    const w = this.container.clientWidth || 540;
    const h = this.container.clientHeight || 360;
    this.orbitCamera.aspect = w / h;
    this.orbitCamera.updateProjectionMatrix();
    this.rovPovCamera.aspect = w / h;
    this.rovPovCamera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    this.animFrameId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (!this.motionPaused && !this.reducedMotion) {
      this.causticUniforms.uTime.value += dt;

      // Drift marine snow in deep bottom current
      const snowAttr = this.marineSnow.geometry.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      for (let i = 0; i < snowAttr.count; i++) {
        let x = snowAttr.getX(i) + dt * 0.48;
        let y = snowAttr.getY(i) - dt * 0.16;
        if (x > 13) x = -13;
        if (y < -0.3) y = 9.5;
        snowAttr.setXY(i, x, y);
      }
      snowAttr.needsUpdate = true;

      // Rise electrolysis gas bubbles from severed copper PFE conductor
      if (this.bubbleParticles.visible) {
        const bAttr = this.bubbleParticles.geometry.getAttribute(
          'position'
        ) as THREE.BufferAttribute;
        for (let i = 0; i < bAttr.count; i++) {
          let y = bAttr.getY(i) + dt * (1.2 + (i % 5) * 0.25);
          let x = bAttr.getX(i) + Math.sin(now * 0.005 + i) * dt * 0.2;
          if (y > 4.6) {
            y = 0.05;
            x = (Math.random() - 0.5) * 1.3;
          }
          bAttr.setXY(i, x, y);
        }
        bAttr.needsUpdate = true;
      }

      // DWDM laser pulses along intact core
      if (this.intactGroup.visible) {
        for (const m of this.fiberPulseMeshes) {
          m.userData.u = (m.userData.u + dt * 0.42) % 1;
          const pt = (m.userData.curve as THREE.CatmullRomCurve3).getPointAt(
            m.userData.u
          );
          m.position.copy(pt);
        }
      }

      // High-voltage PFE plasma arc flicker on severed cable
      if (this.severedGroup.visible) {
        this.plasmaArcMesh.rotation.y += dt * 7;
        this.plasmaArcMesh.rotation.z += dt * 5;
        const flash = Math.random() > 0.25 ? 0.8 + Math.random() * 0.55 : 0.2;
        this.plasmaArcMesh.scale.setScalar(flash);
        this.plasmaLight.intensity = flash * 3.2;
      }

      // Tumbling turbidity landslide rocks
      if (this.landslideGroup.visible) {
        for (const rock of this.landslideRocks) {
          const cycle = ((now * 0.0007 + rock.userData.phase) % 1);
          rock.position.y = THREE.MathUtils.lerp(2.4, 0.15, cycle);
          rock.rotation.x += dt * 2.2;
          rock.rotation.z += dt * 1.8;
        }
      }

      // ROV hovering, hydrodynamic thruster banking, manipulator articulation, and gimbal tracking
      if (this.rovGroup.visible) {
        const t = now * 0.001;
        const cutState = this.currentState?.cutState ?? 'active';
        let hoverY = 2.05 + Math.sin(t * 2.1) * 0.1 + Math.sin(t * 0.85) * 0.05;
        let patrolX = Math.cos(t * 1.05) * 0.56 + Math.sin(t * 0.43) * 0.16;
        let patrolZ = Math.sin(t * 0.88) * 0.28 + Math.cos(t * 0.37) * 0.1;

        if (cutState === 'repairing') {
          const prog = this.currentState?.repairProgress ?? 0.5;
          hoverY =
            prog < 0.3
              ? THREE.MathUtils.lerp(4.8, 1.38, prog / 0.3)
              : 1.38 + Math.sin(t * 2.5) * 0.065 + Math.cos(t * 1.1) * 0.03;
          patrolX = Math.cos(t * 1.45) * 0.14 + Math.sin(t * 0.6) * 0.04;
          patrolZ = Math.sin(t * 1.15) * 0.1 + Math.cos(t * 0.5) * 0.03;
        } else if (cutState === 'severed') {
          hoverY = 2.35 + Math.sin(t * 2.3) * 0.1 + Math.cos(t * 0.9) * 0.05;
          patrolX = Math.cos(t * 1.25) * 0.4 + Math.sin(t * 0.55) * 0.12;
          patrolZ = Math.sin(t * 0.98) * 0.22 + Math.cos(t * 0.42) * 0.08;
        }

        this.rovTargetPos.set(patrolX, hoverY, patrolZ);
        if (!this.rovInitialized) {
          this.rovGroup.position.copy(this.rovTargetPos);
          this.rovPrevPos.copy(this.rovTargetPos);
          this.rovInitialized = true;
        } else {
          this.rovPrevPos.copy(this.rovGroup.position);
          const posAlpha = 1 - Math.exp(-dt * 4.2);
          this.rovGroup.position.lerp(this.rovTargetPos, posAlpha);
        }

        const safeDt = Math.max(dt, 0.001);
        const velAlpha = 1 - Math.exp(-dt * 5.0);
        this.scratchDelta
          .subVectors(this.rovGroup.position, this.rovPrevPos)
          .divideScalar(safeDt);
        this.rovVelocity.lerp(this.scratchDelta, velAlpha);

        // Hydrodynamic pitch/roll bank into lateral thrust + subtle yaw toward splice center
        const targetRoll = THREE.MathUtils.clamp(
          -this.rovVelocity.x * 0.14 + Math.sin(t * 0.72) * 0.025,
          -0.18,
          0.18
        );
        const targetPitch = THREE.MathUtils.clamp(
          this.rovVelocity.z * 0.16 + Math.cos(t * 0.64) * 0.02,
          -0.16,
          0.16
        );
        const targetYaw = THREE.MathUtils.clamp(
          -this.rovGroup.position.x * 0.14 - this.rovVelocity.x * 0.08,
          -0.26,
          0.26
        );
        const attAlpha = 1 - Math.exp(-dt * 4.5);
        this.rovGroup.rotation.z = THREE.MathUtils.lerp(
          this.rovGroup.rotation.z,
          targetRoll,
          attAlpha
        );
        this.rovGroup.rotation.x = THREE.MathUtils.lerp(
          this.rovGroup.rotation.x,
          targetPitch,
          attAlpha
        );
        this.rovGroup.rotation.y = THREE.MathUtils.lerp(
          this.rovGroup.rotation.y,
          targetYaw,
          attAlpha
        );

        this.rovLeftClaw.rotation.z = Math.sin(now * 0.003) * 0.16;
        this.rovRightClaw.rotation.z = -Math.sin(now * 0.003) * 0.16;

        for (const prop of this.rovProps) {
          prop.rotation.z += dt * 22;
        }

        if (this.currentState?.repairPhase === 'splicing') {
          this.rovSpliceArcLight.intensity = Math.random() > 0.3 ? 6.5 : 0.5;
        } else {
          this.rovSpliceArcLight.intensity = 0;
        }
      }
    }

    // Update ROV Nose-Cam mount in world space & spring-damped optical gimbal look target
    this.rovGroup.updateMatrixWorld();
    this.rovNoseWorld.set(0, -0.12, 0.72);
    this.rovGroup.localToWorld(this.rovNoseWorld);

    const tSec = now * 0.001;
    const isRepairing = this.currentState?.cutState === 'repairing';
    if (this.motionPaused || this.reducedMotion || isRepairing) {
      this.rovDesiredFocus.set(0, isRepairing ? -0.18 : -0.15, 0);
    } else {
      this.rovDesiredFocus.set(
        Math.sin(tSec * 0.52) * 0.34,
        -0.15 + Math.cos(tSec * 0.41) * 0.05,
        Math.cos(tSec * 0.36) * 0.08
      );
    }
    const gimbalAlpha = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
    this.rovLookTarget.lerp(this.rovDesiredFocus, gimbalAlpha);

    const desiredRovFov = isRepairing ? 53 : 58;
    if (this.cameraTransition) {
      const tr = this.cameraTransition;
      tr.elapsed = Math.min(tr.duration, tr.elapsed + dt);
      const rawT = tr.duration > 0 ? tr.elapsed / tr.duration : 1;
      const eased = rawT * rawT * rawT * (rawT * (rawT * 6 - 15) + 10);

      if (tr.targetMode === 'rov-pov') {
        this.rovPovCamera.position.lerpVectors(
          tr.fromPos,
          this.rovNoseWorld,
          eased
        );
        this.lookAtMatrix.lookAt(
          this.rovNoseWorld,
          this.rovLookTarget,
          this.worldUp
        );
        this.scratchQuat.setFromRotationMatrix(this.lookAtMatrix);
        this.rovPovCamera.quaternion.slerpQuaternions(
          tr.fromQuat,
          this.scratchQuat,
          eased
        );
        const nextFov = THREE.MathUtils.lerp(tr.fromFov, desiredRovFov, eased);
        if (Math.abs(this.rovPovCamera.fov - nextFov) > 0.01) {
          this.rovPovCamera.fov = nextFov;
          this.rovPovCamera.updateProjectionMatrix();
        }
      } else {
        this.orbitCamera.position.lerpVectors(tr.fromPos, tr.toPos, eased);
        this.controls.target.lerpVectors(tr.fromTarget, tr.toTarget, eased);
        this.lookAtMatrix.lookAt(tr.toPos, tr.toTarget, this.worldUp);
        this.scratchQuat.setFromRotationMatrix(this.lookAtMatrix);
        this.orbitCamera.quaternion.slerpQuaternions(
          tr.fromQuat,
          this.scratchQuat,
          eased
        );
        const nextFov = THREE.MathUtils.lerp(tr.fromFov, tr.toFov, eased);
        if (Math.abs(this.orbitCamera.fov - nextFov) > 0.01) {
          this.orbitCamera.fov = nextFov;
          this.orbitCamera.updateProjectionMatrix();
        }
      }

      if (rawT >= 1) {
        if (tr.targetMode !== 'rov-pov') {
          this.controls.target.copy(tr.toTarget);
          this.controls.enabled = true;
          this.controls.update();
        }
        this.cameraTransition = null;
      }
    } else {
      this.rovPovCamera.position.copy(this.rovNoseWorld);
      this.rovPovCamera.lookAt(this.rovLookTarget);
      if (Math.abs(this.rovPovCamera.fov - desiredRovFov) > 0.02) {
        this.rovPovCamera.fov = THREE.MathUtils.lerp(
          this.rovPovCamera.fov,
          desiredRovFov,
          Math.min(1, dt * 4)
        );
        this.rovPovCamera.updateProjectionMatrix();
      }
    }

    if (this.controls.enabled) {
      const orbitDist = this.orbitCamera.position.distanceTo(
        this.controls.target
      );
      const zoomNorm = THREE.MathUtils.clamp((orbitDist - 1.6) / 14.0, 0, 1);
      this.controls.rotateSpeed = THREE.MathUtils.lerp(0.32, 0.68, zoomNorm);
      this.controls.zoomSpeed = THREE.MathUtils.lerp(0.45, 0.9, zoomNorm);
      this.controls.update();
    }
    this.renderer.render(this.scene, this.activeCamera);
  };

  public dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
