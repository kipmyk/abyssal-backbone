import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import countriesTopo from 'world-atlas/countries-110m.json';
import landTopo from 'world-atlas/land-50m.json';
import {
  SUBSEA_HAZARD_ZONES,
  depthMetersToWorldOffset,
  sampleSeabedDepthMeters,
} from '../data/bathymetry';
import { LANDING_STATIONS, SUBSEA_CABLES } from '../data/networkData';
import type {
  CableRuntimeState,
  LandingStation,
  NetworkSnapshot,
  SubseaCable,
} from '../types/network';

const GLOBE_RADIUS = 10;
const DEG2RAD = Math.PI / 180;

export function latLonToVector3(
  lat: number,
  lon: number,
  radius = GLOBE_RADIUS
): THREE.Vector3 {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (lon + 180) * DEG2RAD;
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}

export function vector3ToLatLon(vec: THREE.Vector3): [number, number] {
  const r = vec.length();
  const phi = Math.acos(THREE.MathUtils.clamp(vec.y / r, -1, 1));
  const lat = 90 - phi / DEG2RAD;
  const theta = Math.atan2(vec.z, -vec.x);
  let lon = theta / DEG2RAD - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  return [lat, lon];
}

interface CableVisual {
  cable: SubseaCable;
  curve: THREE.CatmullRomCurve3;
  tubeMesh: THREE.Mesh;
  hitMesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  shockwaveGroup: THREE.Group;
  shockwaveRing: THREE.Mesh;
  faultBeacon: THREE.Mesh;
  repairShipMesh: THREE.Mesh;
  rovTetherLine: THREE.Line;
  rovBeacon: THREE.Mesh;
  cutShockAge: number;
}

interface RepeaterItem {
  cableId: string;
  matrix: THREE.Matrix4;
}

interface PacketItem {
  cableId: string;
  curve: THREE.CatmullRomCurve3;
  u: number;
  speed: number;
  direction: 1 | -1;
}

interface GlobeCameraFlight {
  startDir: THREE.Vector3;
  endDir: THREE.Vector3;
  rotAxis: THREE.Vector3;
  angle: number;
  startDist: number;
  endDist: number;
  arcLift: number;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  startFov: number;
  endFov: number;
  elapsed: number;
  duration: number;
}

export interface HoverInfo {
  x: number;
  y: number;
  kind: 'station' | 'cable';
  station?: LandingStation;
  cable?: SubseaCable;
  runtime?: CableRuntimeState;
  depthM?: number;
}

export interface ProjectedMarker {
  id: string;
  kind: 'src' | 'dst' | 'fault' | 'ship';
  label: string;
  x: number;
  y: number;
}

export type RenderQualityTier = 'high' | 'balanced' | 'eco';
export type QualityModeSetting = 'auto' | 'high' | 'eco';

export interface GlobeCallbacks {
  onCableClick: (
    cableId: string,
    cutCoord: [number, number],
    progressT: number,
    shiftKey: boolean
  ) => void;
  onStationClick: (stationId: string) => void;
  onHoverChange: (info: HoverInfo | null) => void;
  onMarkersUpdate?: (markers: ProjectedMarker[]) => void;
  onQualityChange?: (tier: RenderQualityTier) => void;
}

export class GlobeScene {
  private container: HTMLElement;
  private callbacks: GlobeCallbacks;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private globeGroup = new THREE.Group();
  private earthMesh!: THREE.Mesh;
  private earthMaterial!: THREE.MeshPhongMaterial;
  private oceanSurfaceMesh!: THREE.Mesh;
  private oceanSurfaceUniforms!: {
    uTime: { value: number };
    uOpacity: { value: number };
    uLandMask: { value: THREE.Texture };
  };
  private nightOverlayMesh!: THREE.Mesh;
  private hazardGroup = new THREE.Group();
  private sunLight!: THREE.DirectionalLight;

  private landMaskCanvas!: HTMLCanvasElement;
  private landMaskData!: Uint8ClampedArray;
  private landMaskTexture!: THREE.CanvasTexture;

  private cableVisuals = new Map<string, CableVisual>();
  private cableHitMeshes: THREE.Mesh[] = [];
  private stationMeshes: THREE.Mesh[] = [];
  private stationRingMeshes = new Map<string, THREE.Mesh>();

  private repeaterMesh!: THREE.InstancedMesh;
  private repeaters: RepeaterItem[] = [];

  private packetMesh!: THREE.InstancedMesh;
  private packets: PacketItem[] = [];
  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = { x: 0, y: 0 };
  private hoveredCableId: string | null = null;
  private hoveredStationId: string | null = null;
  private inspectedCableId: string | null = 'aae1-redsea';
  private inspectedHaloMesh: THREE.Mesh | null = null;
  private hoveredHaloMesh: THREE.Mesh | null = null;

  private selectedCorridorCables = new Set<string>();
  private orderedCorridorCables: string[] = [];
  private fadingCorridorCables = new Set<string>();
  private pathFadeRemaining = 0;
  private pathDrawProgress = 1;
  private readonly goldColor = new THREE.Color(0xfde047);
  private readonly hotGoldColor = new THREE.Color(0xfb7185);
  private readonly baseMixColor = new THREE.Color();

  private selectedEndpoints = new Set<string>();
  private endpointRoles: { srcId: string | null; dstId: string | null } = {
    srcId: null,
    dstId: null,
  };
  private snapshot: NetworkSnapshot | null = null;

  private qualityMode: QualityModeSetting = 'auto';
  private activeQualityTier: RenderQualityTier = 'high';
  private packetStride = 1;
  private fpsSampleTime = 0;
  private fpsSampleFrames = 0;

  private autoOrbit = true;
  private showPulses = true;
  private showHeatmap = true;
  private motionPaused = false;
  private reducedMotion = false;

  private cameraFlight: GlobeCameraFlight | null = null;
  private readonly flightQuat = new THREE.Quaternion();
  private readonly flightVec = new THREE.Vector3();
  private readonly originVec = new THREE.Vector3(0, 0, 0);
  private animFrameId = 0;
  private lastTime = performance.now();
  private resizeObserver: ResizeObserver;

  private onTickCallback: ((dtSeconds: number) => void) | null = null;

  constructor(container: HTMLElement, callbacks: GlobeCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020611);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.08, 400);
    const startPos = latLonToVector3(16, 34, 27.0);
    this.camera.position.copy(startPos);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    const cores = navigator.hardwareConcurrency || 8;
    const mem = (navigator as { deviceMemory?: number }).deviceMemory || 8;
    this.activeQualityTier = cores <= 4 || mem <= 4 ? 'balanced' : 'high';
    this.packetStride = this.activeQualityTier === 'high' ? 1 : 2;
    this.renderer.setPixelRatio(
      this.activeQualityTier === 'high'
        ? Math.min(window.devicePixelRatio, 2)
        : Math.min(window.devicePixelRatio, 1.35)
    );
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    // Allow close-up diving down to inspect seabed trenches, repeaters & ROV tethers
    this.controls.minDistance = 10.65;
    this.controls.maxDistance = 42;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.85;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.autoRotate = this.autoOrbit && !this.motionPaused && !this.reducedMotion;

    this.setupLighting();
    this.buildStarfield();
    this.buildLandMask();
    this.buildDisplacedSeabedEarth();
    this.buildOceanSurfaceShell();
    this.buildCoastlinesAndBorders();
    this.buildHazardZones();
    this.buildAtmosphere();
    this.buildLandingStations();
    this.buildCables();
    this.buildRepeaters();
    this.buildPacketStream();

    this.scene.add(this.globeGroup);

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.animate();
  }

  public setOnTick(cb: (dtSeconds: number) => void): void {
    this.onTickCallback = cb;
  }

  public setAutoOrbit(enabled: boolean): void {
    this.autoOrbit = enabled;
    this.controls.autoRotate = enabled && !this.motionPaused;
    this.controls.autoRotateSpeed = 0.45;
  }

  public setShowPulses(enabled: boolean): void {
    this.showPulses = enabled;
    this.packetMesh.visible = enabled;
  }

  public setShowHeatmap(enabled: boolean): void {
    this.showHeatmap = enabled;
    this.refreshCableColors();
  }

  public setShowTerminator(enabled: boolean): void {
    this.nightOverlayMesh.visible = enabled;
  }

  public setShowHazards(enabled: boolean): void {
    this.hazardGroup.visible = enabled;
  }

  public setShowRepeaters(enabled: boolean): void {
    this.repeaterMesh.visible = enabled;
  }

  public setOceanOpacity(opacity: number): void {
    this.oceanSurfaceUniforms.uOpacity.value = THREE.MathUtils.clamp(
      opacity,
      0,
      0.92
    );
    this.oceanSurfaceMesh.visible = opacity > 0.01;
  }

  public setMotionPaused(paused: boolean): void {
    this.motionPaused = paused;
    this.controls.autoRotate = this.autoOrbit && !paused;
  }

  private startCameraFlight(
    endPos: THREE.Vector3,
    endTarget: THREE.Vector3,
    endFov: number
  ): void {
    const startDir = this.camera.position.clone().normalize();
    const endDir = endPos.clone().normalize();
    const startDist = this.camera.position.length();
    const endDist = endPos.length();

    const dot = THREE.MathUtils.clamp(startDir.dot(endDir), -1, 1);
    const angle = Math.acos(dot);
    const rotAxis = new THREE.Vector3().crossVectors(startDir, endDir);
    if (rotAxis.lengthSq() < 1e-8) {
      const fallback =
        Math.abs(startDir.y) < 0.9
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
      rotAxis.crossVectors(startDir, fallback);
    }
    rotAxis.normalize();

    const peakEndpointDist = Math.max(startDist, endDist);
    const rawLift =
      angle > 0.18
        ? Math.sin(angle * 0.5) *
          THREE.MathUtils.clamp(13.5 - peakEndpointDist * 0.24, 1.4, 6.2)
        : 0;
    const arcLift = Math.min(rawLift, Math.max(0, 38 - peakEndpointDist));

    const duration = this.reducedMotion
      ? 0.2
      : THREE.MathUtils.clamp(
          0.72 + angle * 0.52 + Math.abs(endDist - startDist) * 0.022,
          0.8,
          1.95
        );

    this.cameraFlight = {
      startDir,
      endDir,
      rotAxis,
      angle,
      startDist,
      endDist,
      arcLift,
      startTarget: this.controls.target.clone(),
      endTarget: endTarget.clone(),
      startFov: this.camera.fov,
      endFov,
      elapsed: 0,
      duration,
    };
  }

  public flyTo(lat: number, lon: number, distance = 22): void {
    const endPos = latLonToVector3(lat, lon, distance);
    this.startCameraFlight(endPos, new THREE.Vector3(0, 0, 0), 42);
  }

  /**
   * Dives camera close to a subsea coordinate along an orbital arc with
   * latitude-compensated oblique framing and seabed-accurate pivot targeting.
   */
  public diveTo(lat: number, lon: number): void {
    const depthM = sampleSeabedDepthMeters(lat, lon);
    const seabedRadius = GLOBE_RADIUS + depthMetersToWorldOffset(depthM);
    const cosLat = Math.max(0.28, Math.cos(lat * DEG2RAD));
    const latSign = lat >= 0 ? -1 : 1;
    const camLat = THREE.MathUtils.clamp(lat + latSign * 4.8, -82, 82);
    const camLon = lon - THREE.MathUtils.clamp(5.2 / cosLat, 4.5, 14);

    const endPos = latLonToVector3(camLat, camLon, seabedRadius + 2.35);
    const endTarget = latLonToVector3(lat, lon, seabedRadius);
    this.startCameraFlight(endPos, endTarget, 46);
  }

  public triggerShockwave(cableId: string): void {
    const vis = this.cableVisuals.get(cableId);
    if (vis) {
      vis.cutShockAge = 0.001;
    }
  }

  public setInspectedCable(cableId: string | null): void {
    if (this.inspectedCableId === cableId) return;
    this.inspectedCableId = cableId;
    this.updateHaloMesh('inspected', cableId);
    this.refreshCableColors();
  }

  public setQualityMode(mode: QualityModeSetting): void {
    this.qualityMode = mode;
    if (mode === 'high') {
      this.applyQualityTier('high');
    } else if (mode === 'eco') {
      this.applyQualityTier('eco');
    } else {
      const cores = navigator.hardwareConcurrency || 8;
      const mem = (navigator as { deviceMemory?: number }).deviceMemory || 8;
      this.applyQualityTier(cores <= 4 || mem <= 4 ? 'balanced' : 'high');
    }
  }

  public getActiveQualityTier(): RenderQualityTier {
    return this.activeQualityTier;
  }

  private applyQualityTier(tier: RenderQualityTier): void {
    if (this.activeQualityTier === tier) return;
    this.activeQualityTier = tier;
    this.packetStride = tier === 'high' ? 1 : tier === 'balanced' ? 2 : 3;
    const dprCap = tier === 'high' ? 2 : tier === 'balanced' ? 1.35 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.handleResize();
    this.callbacks.onQualityChange?.(tier);
  }

  private updateHaloMesh(
    kind: 'inspected' | 'hovered',
    cableId: string | null
  ): void {
    const existing =
      kind === 'inspected' ? this.inspectedHaloMesh : this.hoveredHaloMesh;
    if (existing) {
      this.globeGroup.remove(existing);
      existing.geometry.dispose();
      (existing.material as THREE.Material).dispose();
      if (kind === 'inspected') this.inspectedHaloMesh = null;
      else this.hoveredHaloMesh = null;
    }
    if (!cableId) return;
    const vis = this.cableVisuals.get(cableId);
    if (!vis) return;

    const segments = Math.max(48, vis.cable.waypoints.length * 18);
    const radius = kind === 'hovered' ? 0.068 : 0.078;
    const haloGeo = new THREE.TubeGeometry(vis.curve, segments, radius, 6, false);
    const haloMat = new THREE.MeshBasicMaterial({
      color: kind === 'hovered' ? 0xffffff : 0x34d399,
      transparent: true,
      opacity: kind === 'hovered' ? 0.55 : 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(haloGeo, haloMat);
    this.globeGroup.add(mesh);
    if (kind === 'inspected') this.inspectedHaloMesh = mesh;
    else this.hoveredHaloMesh = mesh;
  }

  public updateSnapshot(
    snapshot: NetworkSnapshot,
    highlightedCables: string[],
    endpoints: string[]
  ): void {
    this.snapshot = snapshot;
    const nextSet = new Set(highlightedCables);
    const prevSet = this.selectedCorridorCables;
    const pathChanged =
      highlightedCables.length !== this.orderedCorridorCables.length ||
      highlightedCables.some((id, idx) => id !== this.orderedCorridorCables[idx]);

    if (pathChanged) {
      const removed = new Set<string>();
      for (const id of prevSet) {
        if (!nextSet.has(id)) removed.add(id);
      }
      this.fadingCorridorCables = removed;
      this.pathFadeRemaining = this.reducedMotion ? 0 : 0.72;
      this.pathDrawProgress =
        this.reducedMotion || highlightedCables.length === 0 ? 1 : 0;
    }

    this.selectedCorridorCables = nextSet;
    this.orderedCorridorCables = [...highlightedCables];
    this.selectedEndpoints = new Set(endpoints);
    this.endpointRoles = {
      srcId: endpoints[0] ?? null,
      dstId: endpoints[1] ?? null,
    };
    this.updateHaloMesh('inspected', this.inspectedCableId);
    this.refreshCableColors();
    this.refreshRepeaterColors();
    this.refreshStationHighlights();
  }

  private setupLighting(): void {
    const ambient = new THREE.AmbientLight(0x88b4e6, 0.8);
    this.scene.add(ambient);

    this.sunLight = new THREE.DirectionalLight(0xe0f2fe, 1.5);
    this.sunLight.position.set(22, 14, 18);
    this.scene.add(this.sunLight);

    const rimLight = new THREE.DirectionalLight(0x0ea5e9, 0.5);
    rimLight.position.set(-20, -10, -16);
    this.scene.add(rimLight);
  }

  private buildStarfield(): void {
    const count = 1600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const c = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const r = 85 + Math.random() * 65;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      const tint = 0.55 + Math.random() * 0.45;
      c.setRGB(tint * 0.75, tint * 0.88, tint);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.32,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      sizeAttenuation: true,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  private buildLandMask(): void {
    const w = 1024;
    const h = 512;
    this.landMaskCanvas = document.createElement('canvas');
    this.landMaskCanvas.width = w;
    this.landMaskCanvas.height = h;
    const ctx = this.landMaskCanvas.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    const landData = feature(
      landTopo as unknown as Topology,
      (landTopo as unknown as { objects: { land: GeometryCollection } }).objects
        .land
    );

    const drawRings = (rings: number[][][]) => {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], idx) => {
          const x = ((lon + 180) / 360) * w;
          const y = ((90 - lat) / 180) * h;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
    };

    ctx.fillStyle = '#ffffff';
    const geoms =
      landData.type === 'FeatureCollection'
        ? landData.features.map((f) => f.geometry)
        : [];
    for (const geom of geoms) {
      if (!geom) continue;
      if (geom.type === 'Polygon') {
        drawRings(geom.coordinates);
        ctx.fill('evenodd');
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          drawRings(poly);
          ctx.fill('evenodd');
        }
      }
    }

    this.landMaskData = ctx.getImageData(0, 0, w, h).data;
    this.landMaskTexture = new THREE.CanvasTexture(this.landMaskCanvas);
    this.landMaskTexture.wrapS = THREE.RepeatWrapping;
  }

  private isLandAt(lat: number, lon: number): boolean {
    const w = this.landMaskCanvas.width;
    const h = this.landMaskCanvas.height;
    let normLon = lon;
    while (normLon < -180) normLon += 360;
    while (normLon > 180) normLon -= 360;
    const x = Math.min(w - 1, Math.max(0, Math.floor(((normLon + 180) / 360) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
    return this.landMaskData[(y * w + x) * 4] > 100;
  }

  private buildDisplacedSeabedEarth(): void {
    const { colorTexture, bumpTexture } = this.generateBathymetryTexture();
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 192, 96);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const [lat, lon] = vector3ToLatLon(v);
      const onLand = this.isLandAt(lat, lon);
      let radius = GLOBE_RADIUS + 0.025;
      if (!onLand) {
        const depthM = sampleSeabedDepthMeters(lat, lon);
        radius = GLOBE_RADIUS + depthMetersToWorldOffset(depthM);
      } else {
        // Subtle continental mountain relief displacement
        const mountainWave =
          Math.max(
            0,
            Math.sin((lat + 12) * 0.14) * Math.cos((lon - 75) * 0.11) +
              Math.sin(lat * 0.25 - lon * 0.18) * 0.5
          ) * 0.07;
        radius = GLOBE_RADIUS + 0.025 + mountainWave;
      }
      v.normalize().multiplyScalar(radius);
      pos.setXYZ(i, v.x, v.y, v.z);
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();

    this.earthMaterial = new THREE.MeshPhongMaterial({
      map: colorTexture,
      bumpMap: bumpTexture,
      bumpScale: 0.09,
      specular: new THREE.Color(0x0c3454),
      shininess: 18,
      emissive: new THREE.Color(0x030c1c),
      emissiveIntensity: 0.38,
    });

    this.earthMesh = new THREE.Mesh(geo, this.earthMaterial);
    this.globeGroup.add(this.earthMesh);

    const nightGeo = new THREE.SphereGeometry(GLOBE_RADIUS + 0.032, 64, 48);
    const nightMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.7, 0.35, 0.62).normalize() },
      },
      vertexShader: `
        varying vec3 vNormalWorld;
        void main() {
          vNormalWorld = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vNormalWorld;
        void main() {
          float ndotl = dot(normalize(vNormalWorld), normalize(uSunDir));
          float night = smoothstep(0.18, -0.22, ndotl);
          float twilightBand = exp(-pow(ndotl * 7.5, 2.0)) * 0.2;
          vec3 col = mix(vec3(0.01, 0.03, 0.08), vec3(0.08, 0.42, 0.78), twilightBand);
          gl_FragColor = vec4(col, night * 0.48 + twilightBand);
        }
      `,
    });
    this.nightOverlayMesh = new THREE.Mesh(nightGeo, nightMat);
    this.globeGroup.add(this.nightOverlayMesh);
  }

  private buildOceanSurfaceShell(): void {
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS + 0.005, 128, 64);
    this.oceanSurfaceUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0.36 },
      uLandMask: { value: this.landMaskTexture },
    };

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: this.oceanSurfaceUniforms,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewPos;
        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform sampler2D uLandMask;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vViewPos;

        void main() {
          float land = texture2D(uLandMask, vUv).r;
          if (land > 0.35) discard;

          // Subtle animated wave-caustic lattice on sea surface
          float waveA = sin(vUv.x * 260.0 + uTime * 1.4 + sin(vUv.y * 130.0)) * 0.5 + 0.5;
          float waveB = cos(vUv.y * 180.0 - uTime * 1.1 + cos(vUv.x * 160.0)) * 0.5 + 0.5;
          float caustic = pow(waveA * waveB, 3.0) * 0.32;

          // Fresnel surface sheen
          vec3 viewDir = normalize(vViewPos);
          float fresnel = pow(1.0 - max(0.0, dot(normalize(vNormal), viewDir)), 2.2);

          vec3 waterCol = vec3(0.04, 0.34, 0.56) + vec3(0.18, 0.65, 0.88) * (caustic + fresnel * 0.6);
          float alpha = uOpacity * (0.48 + fresnel * 0.52 + caustic * 0.3);
          gl_FragColor = vec4(waterCol, alpha);
        }
      `,
    });

    this.oceanSurfaceMesh = new THREE.Mesh(geo, mat);
    this.globeGroup.add(this.oceanSurfaceMesh);
  }

  private generateBathymetryTexture(): {
    colorTexture: THREE.CanvasTexture;
    bumpTexture: THREE.CanvasTexture;
  } {
    const width = 2048;
    const height = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = width;
    bumpCanvas.height = height;
    const bumpCtx = bumpCanvas.getContext('2d')!;

    const img = ctx.createImageData(width, height);
    const data = img.data;
    const bumpImg = bumpCtx.createImageData(width, height);
    const bumpData = bumpImg.data;

    for (let y = 0; y < height; y += 2) {
      const lat = 90 - (y / height) * 180;
      const absLat = Math.abs(lat);
      for (let x = 0; x < width; x += 2) {
        const lon = (x / width) * 360 - 180;
        const onLand = this.isLandAt(lat, lon);

        // Multi-octave procedural terrain/bathymetry relief
        const n1 = Math.sin(lat * 0.24 + lon * 0.19) * Math.cos(lat * 0.17 - lon * 0.28);
        const n2 = Math.sin(lat * 0.68 - lon * 0.52) * Math.cos(lat * 0.49 + lon * 0.63) * 0.5;
        const n3 = Math.sin(lat * 1.6 + lon * 1.4) * 0.25;
        const relief = (n1 + n2 + n3) * 0.5 + 0.5;

        let r: number;
        let g: number;
        let b: number;
        let bumpVal: number;

        if (!onLand) {
          const depthM = sampleSeabedDepthMeters(lat, lon);
          const absD = -depthM;
          bumpVal = Math.max(0, Math.min(120, Math.round(120 - (absD / 8500) * 110 + relief * 18)));

          if (absD < 350) {
            // Continental shelf: luminous coastal turquoise
            const t = absD / 350;
            r = 14 - t * 4 + relief * 8;
            g = 92 - t * 34 + relief * 12;
            b = 132 - t * 28 + relief * 14;
          } else if (absD < 2600) {
            // Continental slope & mid-ocean ridges: cobalt relief
            const t = (absD - 350) / 2250;
            r = 9 - t * 4 + relief * 6;
            g = 54 - t * 26 + relief * 10;
            b = 98 - t * 38 + relief * 14;
          } else if (absD < 5200) {
            // Abyssal plain & fracture zones: deep marine slate
            const t = (absD - 2600) / 2600;
            r = 4 - t * 2 + relief * 4;
            g = 24 - t * 12 + relief * 7;
            b = 56 - t * 26 + relief * 10;
          } else {
            // Hadal trench: obsidian indigo
            const t = Math.min(1, (absD - 5200) / 3600);
            r = 2 + relief * 2;
            g = 9 - t * 5 + relief * 4;
            b = 26 - t * 13 + relief * 6;
          }
        } else {
          // Realistic satellite-inspired shaded continental biomes
          const isDesertBelt =
            (lat > 12 && lat < 33 && lon > -18 && lon < 62) || // Sahara + Arabian + Thar
            (lat > -31 && lat < -18 && lon > 114 && lon < 145) || // Australian Outback
            (lat > 24 && lat < 44 && lon > 65 && lon < 108); // Gobi / Taklamakan
          const isHighMountain =
            (lat > 26 && lat < 40 && lon > 68 && lon < 102) || // Himalayas / Tibetan Plateau
            (lat > -45 && lat < 10 && lon > -80 && lon < -64) || // Andes
            (lat > 32 && lat < 55 && lon > -124 && lon < -104) || // Rockies
            (lat > 43 && lat < 48 && lon > 5 && lon < 16); // Alps

          bumpVal = Math.min(
            255,
            Math.round(135 + relief * 75 + (isHighMountain ? 45 : 0))
          );

          if (absLat > 68) {
            // Polar ice cap & tundra
            r = 152 + relief * 36;
            g = 176 + relief * 36;
            b = 198 + relief * 32;
          } else if (isHighMountain) {
            // Alpine & highland ridges
            r = 56 + relief * 42;
            g = 62 + relief * 38;
            b = 68 + relief * 36;
          } else if (isDesertBelt) {
            // Arid ochre/sandstone desert biome
            r = 74 + relief * 34;
            g = 58 + relief * 24;
            b = 42 + relief * 16;
          } else if (absLat < 16) {
            // Equatorial tropical rainforest biome
            r = 16 + relief * 16;
            g = 46 + relief * 24;
            b = 32 + relief * 16;
          } else {
            // Temperate forest & steppe biome
            r = 24 + relief * 22;
            g = 44 + relief * 24;
            b = 38 + relief * 18;
          }
        }

        // Fill 2x2 pixel block
        for (let dy = 0; dy < 2 && y + dy < height; dy++) {
          for (let dx = 0; dx < 2 && x + dx < width; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            data[idx] = Math.max(0, Math.min(255, r));
            data[idx + 1] = Math.max(0, Math.min(255, g));
            data[idx + 2] = Math.max(0, Math.min(255, b));
            data[idx + 3] = 255;

            bumpData[idx] = bumpVal;
            bumpData[idx + 1] = bumpVal;
            bumpData[idx + 2] = bumpVal;
            bumpData[idx + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    bumpCtx.putImageData(bumpImg, 0, 0);

    // Subtle lat/lon hydrographic graticule
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.065)';
    ctx.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 15) {
      const x = ((lon + 180) / 360) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let lat = -75; lat <= 75; lat += 15) {
      const y = ((90 - lat) / 180) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Crisp continental shelf shoreline stroke
    const landData = feature(
      landTopo as unknown as Topology,
      (landTopo as unknown as { objects: { land: GeometryCollection } }).objects
        .land
    );
    const drawRings = (rings: number[][][]) => {
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], idx) => {
          const x = ((lon + 180) / 360) * width;
          const y = ((90 - lat) / 180) * height;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
    };

    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.38)';
    ctx.lineWidth = 1.1;
    const geoms =
      landData.type === 'FeatureCollection'
        ? landData.features.map((f) => f.geometry)
        : [];
    for (const geom of geoms) {
      if (!geom) continue;
      if (geom.type === 'Polygon') {
        drawRings(geom.coordinates);
        ctx.stroke();
      } else if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          drawRings(poly);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    const colorTexture = new THREE.CanvasTexture(canvas);
    colorTexture.colorSpace = THREE.SRGBColorSpace;
    colorTexture.anisotropy = 8;

    const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
    bumpTexture.anisotropy = 4;

    return { colorTexture, bumpTexture };
  }

  private buildCoastlinesAndBorders(): void {
    const landData = feature(
      landTopo as unknown as Topology,
      (landTopo as unknown as { objects: { land: GeometryCollection } }).objects
        .land
    );
    const countriesData = feature(
      countriesTopo as unknown as Topology,
      (
        countriesTopo as unknown as {
          objects: { countries: GeometryCollection };
        }
      ).objects.countries
    );

    const buildLineSegments = (
      geojson: ReturnType<typeof feature>,
      radius: number,
      color: number,
      opacity: number
    ) => {
      const positions: number[] = [];
      const addRing = (ring: number[][]) => {
        for (let i = 0; i < ring.length - 1; i++) {
          const [lon1, lat1] = ring[i];
          const [lon2, lat2] = ring[i + 1];
          if (Math.abs(lon1 - lon2) > 90) continue;
          const p1 = latLonToVector3(lat1, lon1, radius);
          const p2 = latLonToVector3(lat2, lon2, radius);
          positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        }
      };

      const geoms =
        geojson.type === 'FeatureCollection'
          ? geojson.features.map((f) => f.geometry)
          : [geojson.geometry];

      for (const geom of geoms) {
        if (!geom) continue;
        if (geom.type === 'Polygon') geom.coordinates.forEach(addRing);
        else if (geom.type === 'MultiPolygon') {
          geom.coordinates.forEach((poly) => poly.forEach(addRing));
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(positions, 3)
      );
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
      });
      return new THREE.LineSegments(geo, mat);
    };

    this.globeGroup.add(
      buildLineSegments(countriesData, GLOBE_RADIUS + 0.025, 0x1e3a5f, 0.44)
    );
    this.globeGroup.add(
      buildLineSegments(landData, GLOBE_RADIUS + 0.03, 0x38bdf8, 0.36)
    );
  }

  private buildHazardZones(): void {
    for (const hz of SUBSEA_HAZARD_ZONES) {
      const depthM = sampleSeabedDepthMeters(hz.lat, hz.lon);
      const r = GLOBE_RADIUS + depthMetersToWorldOffset(depthM) + 0.035;
      const pos = latLonToVector3(hz.lat, hz.lon, r);
      const normal = pos.clone().normalize();

      const worldRad = (hz.radiusDeg * DEG2RAD) * GLOBE_RADIUS * 0.62;
      const ringGeo = new THREE.RingGeometry(worldRad * 0.78, worldRad, 36);
      const color = hz.kind === 'anchor' ? 0xf59e0b : 0xe11d48;
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      this.hazardGroup.add(ring);
    }
    this.globeGroup.add(this.hazardGroup);
  }

  private buildAtmosphere(): void {
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.11, 64, 48);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.66 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
          gl_FragColor = vec4(0.08, 0.58, 0.95, 1.0) * intensity * 0.92;
        }
      `,
    });
    this.globeGroup.add(new THREE.Mesh(geo, mat));
  }

  private buildLandingStations(): void {
    const coreGeo = new THREE.SphereGeometry(0.105, 14, 14);
    const ringGeo = new THREE.RingGeometry(0.14, 0.22, 24);

    for (const station of LANDING_STATIONS) {
      const pos = latLonToVector3(station.lat, station.lon, GLOBE_RADIUS + 0.055);
      const normal = pos.clone().normalize();

      const mat = new THREE.MeshBasicMaterial({
        color: station.tier === 1 ? 0x38bdf8 : 0x64748b,
      });
      const mesh = new THREE.Mesh(coreGeo, mat);
      mesh.position.copy(pos);
      mesh.userData = { kind: 'station', stationId: station.id };
      this.globeGroup.add(mesh);
      this.stationMeshes.push(mesh);

      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.0,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(
        latLonToVector3(station.lat, station.lon, GLOBE_RADIUS + 0.04)
      );
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      this.globeGroup.add(ring);
      this.stationRingMeshes.set(station.id, ring);
    }
  }

  /**
   * Drapes subsea cables directly onto the displaced bathymetric seabed topography!
   */
  private buildSphericalCurve(cable: SubseaCable): THREE.CatmullRomCurve3 {
    const pts: THREE.Vector3[] = [];

    const placePoint = (lat: number, lon: number) => {
      if (cable.isTerrestrial) {
        return latLonToVector3(lat, lon, GLOBE_RADIUS + 0.032);
      }
      const onLand = this.isLandAt(lat, lon);
      // Rest cable flush on the displaced seabed surface (+0.008 anti-z-fight clearance)
      const depthOffset = onLand
        ? 0.026
        : depthMetersToWorldOffset(sampleSeabedDepthMeters(lat, lon)) + 0.008;
      return latLonToVector3(lat, lon, GLOBE_RADIUS + depthOffset);
    };

    for (let i = 0; i < cable.waypoints.length - 1; i++) {
      const [lat1, lon1] = cable.waypoints[i];
      const [lat2, lon2] = cable.waypoints[i + 1];
      const v1 = latLonToVector3(lat1, lon1, 1).normalize();
      const v2 = latLonToVector3(lat2, lon2, 1).normalize();
      const angle = v1.angleTo(v2);
      const steps = Math.max(4, Math.ceil((angle * 180) / Math.PI / 2.2));

      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const slerped = new THREE.Vector3().copy(v1).lerp(v2, t).normalize();
        const [pLat, pLon] = vector3ToLatLon(slerped);
        pts.push(placePoint(pLat, pLon));
      }
    }

    const last = cable.waypoints[cable.waypoints.length - 1];
    pts.push(placePoint(last[0], last[1]));

    return new THREE.CatmullRomCurve3(pts);
  }

  private buildCables(): void {
    const shockGeo = new THREE.RingGeometry(0.12, 0.24, 32);
    const beaconGeo = new THREE.SphereGeometry(0.12, 12, 12);
    const shipGeo = new THREE.ConeGeometry(0.12, 0.32, 4);
    const rovGeo = new THREE.SphereGeometry(0.085, 10, 10);

    for (const cable of SUBSEA_CABLES) {
      const curve = this.buildSphericalCurve(cable);
      const tubularSegments = Math.max(48, cable.waypoints.length * 18);
      const tubeRadius = cable.isTerrestrial ? 0.024 : 0.034;

      const geo = new THREE.TubeGeometry(curve, tubularSegments, tubeRadius, 6, false);
      const mat = new THREE.MeshBasicMaterial({
        color: cable.isTerrestrial ? 0x818cf8 : 0x06b6d4,
        transparent: true,
        opacity: 0.88,
      });
      const tubeMesh = new THREE.Mesh(geo, mat);
      this.globeGroup.add(tubeMesh);

      const hitGeo = new THREE.TubeGeometry(curve, tubularSegments, 0.16, 6, false);
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.userData = { kind: 'cable', cableId: cable.id };
      this.globeGroup.add(hitMesh);
      this.cableHitMeshes.push(hitMesh);

      const shockwaveGroup = new THREE.Group();
      shockwaveGroup.visible = false;

      const shockMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
      });
      const shockwaveRing = new THREE.Mesh(shockGeo, shockMat);
      shockwaveGroup.add(shockwaveRing);

      const beaconMat = new THREE.MeshBasicMaterial({ color: 0xf87171 });
      const faultBeacon = new THREE.Mesh(beaconGeo, beaconMat);
      shockwaveGroup.add(faultBeacon);
      this.globeGroup.add(shockwaveGroup);

      // Surface cable repair vessel
      const shipMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
      const repairShipMesh = new THREE.Mesh(shipGeo, shipMat);
      repairShipMesh.visible = false;
      this.globeGroup.add(repairShipMesh);

      // Vertical ROV / grapnel tether line from sea surface down to seabed fault
      const tetherGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]);
      const tetherMat = new THREE.LineBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0.9,
      });
      const rovTetherLine = new THREE.Line(tetherGeo, tetherMat);
      rovTetherLine.visible = false;
      this.globeGroup.add(rovTetherLine);

      const rovMat = new THREE.MeshBasicMaterial({ color: 0x34d399 });
      const rovBeacon = new THREE.Mesh(rovGeo, rovMat);
      rovBeacon.visible = false;
      this.globeGroup.add(rovBeacon);

      this.cableVisuals.set(cable.id, {
        cable,
        curve,
        tubeMesh,
        hitMesh,
        material: mat,
        shockwaveGroup,
        shockwaveRing,
        faultBeacon,
        repairShipMesh,
        rovTetherLine,
        rovBeacon,
        cutShockAge: 10,
      });
    }
  }

  /**
   * Builds 3D cylindrical EDFA optical repeater pods resting along seabed cables.
   */
  private buildRepeaters(): void {
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (const cable of SUBSEA_CABLES) {
      if (cable.isTerrestrial) continue;
      const vis = this.cableVisuals.get(cable.id)!;
      const podCount = Math.max(2, Math.min(12, Math.floor(cable.lengthKm / 750)));
      for (let i = 1; i <= podCount; i++) {
        const t = i / (podCount + 1);
        const pos = vis.curve.getPointAt(t);
        const tangent = vis.curve.getTangentAt(t).normalize();
        quat.setFromUnitVectors(up, tangent);
        const mat4 = new THREE.Matrix4().compose(pos, quat, scale);
        this.repeaters.push({ cableId: cable.id, matrix: mat4 });
      }
    }

    const podGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.14, 8);
    const podMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.repeaterMesh = new THREE.InstancedMesh(
      podGeo,
      podMat,
      this.repeaters.length
    );
    this.repeaters.forEach((r, idx) => {
      this.repeaterMesh.setMatrixAt(idx, r.matrix);
      this.repeaterMesh.setColorAt(idx, new THREE.Color(0x22d3ee));
    });
    this.repeaterMesh.instanceMatrix.needsUpdate = true;
    if (this.repeaterMesh.instanceColor) {
      this.repeaterMesh.instanceColor.needsUpdate = true;
    }
    this.globeGroup.add(this.repeaterMesh);
  }

  private refreshRepeaterColors(): void {
    if (!this.snapshot) return;
    for (let i = 0; i < this.repeaters.length; i++) {
      const rep = this.repeaters[i];
      const st = this.snapshot.cables.get(rep.cableId);
      if (!st || st.cutState === 'severed' || st.cutState === 'repairing') {
        this.tmpColor.setHex(st?.cutState === 'repairing' ? 0xf59e0b : 0x7f1d1d);
      } else if (st.cutState === 'degraded') {
        this.tmpColor.setHex(0xf59e0b);
      } else if (this.selectedCorridorCables.has(rep.cableId)) {
        this.tmpColor.setHex(0xfef08a);
      } else {
        this.tmpColor.setHex(0x2dd4bf);
      }
      this.repeaterMesh.setColorAt(i, this.tmpColor);
    }
    if (this.repeaterMesh.instanceColor) {
      this.repeaterMesh.instanceColor.needsUpdate = true;
    }
  }

  private buildPacketStream(): void {
    for (const cable of SUBSEA_CABLES) {
      const vis = this.cableVisuals.get(cable.id)!;
      const packetCount = Math.min(18, Math.max(8, Math.round(cable.capacityTbps / 18)));
      for (let i = 0; i < packetCount; i++) {
        this.packets.push({
          cableId: cable.id,
          curve: vis.curve,
          u: i / packetCount,
          speed: 0.14 + Math.min(0.28, cable.capacityTbps / 950),
          direction: i % 2 === 0 ? 1 : -1,
        });
      }
    }

    const geo = new THREE.SphereGeometry(0.062, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
    });
    this.packetMesh = new THREE.InstancedMesh(geo, mat, this.packets.length);
    this.packetMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.globeGroup.add(this.packetMesh);
  }

  private refreshCableColors(): void {
    if (!this.snapshot) return;
    for (const [id, vis] of this.cableVisuals) {
      const state = this.snapshot.cables.get(id);
      if (!state) continue;

      const isHovered = this.hoveredCableId === id;
      const isInspected = this.inspectedCableId === id;
      const isHighlighted = this.selectedCorridorCables.has(id);
      const isFading =
        !isHighlighted &&
        this.pathFadeRemaining > 0 &&
        this.fadingCorridorCables.has(id);
      const hasCorridorFocus = this.orderedCorridorCables.length > 0;

      if (state.cutState === 'severed' || state.cutState === 'repairing') {
        vis.material.color.setHex(
          state.cutState === 'repairing' ? 0xf59e0b : 0x7f1d1d
        );
        vis.material.opacity = state.cutState === 'repairing' ? 0.68 : 0.45;

        const cutPos = vis.curve.getPointAt(
          THREE.MathUtils.clamp(state.cutProgressT, 0, 1)
        );
        const normal = cutPos.clone().normalize();
        vis.shockwaveGroup.position.copy(cutPos);
        vis.shockwaveRing.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          normal
        );
        vis.shockwaveGroup.visible = true;

        if (state.cutState === 'repairing') {
          vis.repairShipMesh.visible = true;
          // Ship rides ON the sea surface above the cable
          const shipT = THREE.MathUtils.lerp(
            0.05,
            state.cutProgressT,
            Math.min(1, state.repairProgress / 0.3)
          );
          const seabedPt = vis.curve.getPointAt(
            THREE.MathUtils.clamp(shipT, 0, 1)
          );
          const surfaceNormal = seabedPt.clone().normalize();
          const surfaceShipPos = surfaceNormal
            .clone()
            .multiplyScalar(GLOBE_RADIUS + 0.08);
          vis.repairShipMesh.position.copy(surfaceShipPos);
          vis.repairShipMesh.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            surfaceNormal
          );

          // Deploy vertical ROV / grapnel tether from surface ship down to seabed fault
          if (state.repairProgress >= 0.3) {
            const rovDepthFraction =
              state.repairPhase === 'grappling'
                ? Math.min(1, (state.repairProgress - 0.3) / 0.25)
                : 1;
            const rovPos = surfaceShipPos.clone().lerp(cutPos, rovDepthFraction);
            const posAttr = vis.rovTetherLine.geometry.getAttribute(
              'position'
            ) as THREE.BufferAttribute;
            posAttr.setXYZ(0, surfaceShipPos.x, surfaceShipPos.y, surfaceShipPos.z);
            posAttr.setXYZ(1, rovPos.x, rovPos.y, rovPos.z);
            posAttr.needsUpdate = true;
            vis.rovTetherLine.visible = true;
            vis.rovBeacon.position.copy(rovPos);
            vis.rovBeacon.visible = true;
          } else {
            vis.rovTetherLine.visible = false;
            vis.rovBeacon.visible = false;
          }
        } else {
          vis.repairShipMesh.visible = false;
          vis.rovTetherLine.visible = false;
          vis.rovBeacon.visible = false;
        }
        continue;
      }

      vis.shockwaveGroup.visible = state.cutState === 'degraded';
      if (state.cutState === 'degraded') {
        const cutPos = vis.curve.getPointAt(
          THREE.MathUtils.clamp(state.cutProgressT, 0, 1)
        );
        const normal = cutPos.clone().normalize();
        vis.shockwaveGroup.position.copy(cutPos);
        vis.shockwaveRing.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          normal
        );
      }
      vis.repairShipMesh.visible = false;
      vis.rovTetherLine.visible = false;
      vis.rovBeacon.visible = false;

      const baseHex =
        state.cutState === 'degraded'
          ? 0xf59e0b
          : this.showHeatmap && state.utilization >= 0.9
          ? 0xf43f5e
          : this.showHeatmap && state.utilization >= 0.68
          ? 0xf59e0b
          : vis.cable.isTerrestrial
          ? 0x818cf8
          : 0x0ea5e9;

      if (isHovered) {
        vis.material.color.setHex(0xffffff);
        vis.material.opacity = 1.0;
      } else if (state.cutState === 'degraded') {
        vis.material.color.setHex(0xf59e0b);
        vis.material.opacity = 0.95;
      } else if (isHighlighted) {
        const hopIndex = this.orderedCorridorCables.indexOf(id);
        const hopCount = Math.max(1, this.orderedCorridorCables.length);
        const reveal =
          this.pathDrawProgress >= 1
            ? 1
            : THREE.MathUtils.clamp(
                (this.pathDrawProgress * (hopCount + 0.35) - hopIndex * 0.55) /
                  0.65,
                0,
                1
              );
        this.baseMixColor.setHex(baseHex);
        const targetCol =
          state.utilization >= 0.85 ? this.hotGoldColor : this.goldColor;
        vis.material.color.lerpColors(this.baseMixColor, targetCol, reveal);
        vis.material.opacity = THREE.MathUtils.lerp(0.65, 1.0, reveal);
      } else if (isFading) {
        const fadeT = THREE.MathUtils.clamp(this.pathFadeRemaining / 0.72, 0, 1);
        this.baseMixColor.setHex(baseHex);
        vis.material.color.lerpColors(this.baseMixColor, this.goldColor, fadeT);
        vis.material.opacity = THREE.MathUtils.lerp(0.68, 0.95, fadeT);
      } else if (isInspected) {
        vis.material.color.setHex(0x34d399);
        vis.material.opacity = 0.98;
      } else {
        vis.material.color.setHex(baseHex);
        vis.material.opacity = hasCorridorFocus
          ? 0.52
          : vis.cable.isTerrestrial
          ? 0.78
          : 0.85;
      }
    }
  }

  private refreshStationHighlights(): void {
    for (const mesh of this.stationMeshes) {
      const id = mesh.userData.stationId as string;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const ring = this.stationRingMeshes.get(id);
      const isSelected = this.selectedEndpoints.has(id);
      const isHovered = this.hoveredStationId === id;

      if (isSelected) {
        mat.color.setHex(0xfde047);
        mesh.scale.setScalar(1.55);
        if (ring) {
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.92;
        }
      } else if (isHovered) {
        mat.color.setHex(0xffffff);
        mesh.scale.setScalar(1.45);
        if (ring) {
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.4;
        }
      } else {
        const station = LANDING_STATIONS.find((s) => s.id === id);
        mat.color.setHex(station?.tier === 1 ? 0x38bdf8 : 0x64748b);
        mesh.scale.setScalar(1.0);
        if (ring) {
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.0;
        }
      }
    }
  }

  private bindEvents(): void {
    const dom = this.renderer.domElement;

    this.controls.addEventListener('start', () => {
      this.cameraFlight = null;
    });

    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.cameraFlight = null;
    });

    dom.addEventListener('pointermove', (e) => {
      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.updateHover(e.clientX, e.clientY);
    });

    dom.addEventListener('pointerleave', () => {
      this.hoveredCableId = null;
      this.hoveredStationId = null;
      this.updateHaloMesh('hovered', null);
      this.callbacks.onHoverChange(null);
      this.refreshCableColors();
      this.refreshStationHighlights();
    });

    dom.addEventListener('click', (e) => {
      const dist = Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y
      );
      if (dist > 6) return;

      this.raycaster.setFromCamera(this.pointer, this.camera);

      const stationHits = this.raycaster.intersectObjects(
        this.stationMeshes,
        false
      );
      if (stationHits.length > 0) {
        const stationId = stationHits[0].object.userData.stationId as string;
        this.callbacks.onStationClick(stationId);
        return;
      }

      const cableHits = this.raycaster.intersectObjects(
        this.cableHitMeshes,
        false
      );
      if (cableHits.length > 0) {
        const hit = cableHits[0];
        const cableId = hit.object.userData.cableId as string;
        const coord = vector3ToLatLon(hit.point);
        const vis = this.cableVisuals.get(cableId);
        let progressT = 0.5;
        if (vis) {
          let bestDist = Infinity;
          for (let i = 0; i <= 48; i++) {
            const t = i / 48;
            const d = vis.curve.getPointAt(t).distanceToSquared(hit.point);
            if (d < bestDist) {
              bestDist = d;
              progressT = t;
            }
          }
        }
        this.callbacks.onCableClick(cableId, coord, progressT, e.shiftKey);
      }
    });
  }

  private updateHover(clientX: number, clientY: number): void {
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const stationHits = this.raycaster.intersectObjects(
      this.stationMeshes,
      false
    );
    if (stationHits.length > 0) {
      const stationId = stationHits[0].object.userData.stationId as string;
      const station = LANDING_STATIONS.find((s) => s.id === stationId);
      if (station) {
        const prevHoveredCable = this.hoveredCableId;
        this.hoveredStationId = stationId;
        this.hoveredCableId = null;
        if (prevHoveredCable !== null) {
          this.updateHaloMesh('hovered', null);
        }
        this.renderer.domElement.style.cursor = 'pointer';
        this.callbacks.onHoverChange({
          x: clientX,
          y: clientY,
          kind: 'station',
          station,
        });
        this.refreshStationHighlights();
        this.refreshCableColors();
        return;
      }
    }

    const cableHits = this.raycaster.intersectObjects(
      this.cableHitMeshes,
      false
    );
    if (cableHits.length > 0) {
      const hit = cableHits[0];
      const cableId = hit.object.userData.cableId as string;
      const cable = SUBSEA_CABLES.find((c) => c.id === cableId);
      if (cable) {
        const [lat, lon] = vector3ToLatLon(hit.point);
        const depthM = cable.isTerrestrial
          ? 0
          : sampleSeabedDepthMeters(lat, lon);
        const changed = this.hoveredCableId !== cableId;
        this.hoveredCableId = cableId;
        this.hoveredStationId = null;
        if (changed) {
          this.updateHaloMesh('hovered', cableId);
        }
        this.renderer.domElement.style.cursor = 'pointer';
        this.callbacks.onHoverChange({
          x: clientX,
          y: clientY,
          kind: 'cable',
          cable,
          runtime: this.snapshot?.cables.get(cableId),
          depthM,
        });
        this.refreshStationHighlights();
        this.refreshCableColors();
        return;
      }
    }

    if (this.hoveredCableId || this.hoveredStationId) {
      this.hoveredCableId = null;
      this.hoveredStationId = null;
      this.updateHaloMesh('hovered', null);
      this.renderer.domElement.style.cursor = 'grab';
      this.callbacks.onHoverChange(null);
      this.refreshStationHighlights();
      this.refreshCableColors();
    }
  }

  private handleResize(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private animate = (): void => {
    this.animFrameId = requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (!this.motionPaused && !this.reducedMotion) {
      this.oceanSurfaceUniforms.uTime.value +=
        this.activeQualityTier === 'eco' ? dt * 0.45 : dt;
    }

    // Adaptive GPU quality monitor over a 1.5s rolling frame window
    if (this.qualityMode === 'auto') {
      this.fpsSampleTime += dt;
      this.fpsSampleFrames += 1;
      if (this.fpsSampleTime >= 1.5) {
        const avgFps = this.fpsSampleFrames / this.fpsSampleTime;
        this.fpsSampleTime = 0;
        this.fpsSampleFrames = 0;
        if (avgFps < 34 && this.activeQualityTier === 'high') {
          this.applyQualityTier('balanced');
        } else if (avgFps < 24 && this.activeQualityTier === 'balanced') {
          this.applyQualityTier('eco');
        }
      }
    }

    if (this.pathDrawProgress < 1 || this.pathFadeRemaining > 0) {
      this.pathDrawProgress = Math.min(1, this.pathDrawProgress + dt / 0.85);
      this.pathFadeRemaining = Math.max(0, this.pathFadeRemaining - dt);
      if (this.pathFadeRemaining <= 0) {
        this.fadingCorridorCables.clear();
      }
      this.refreshCableColors();
    }

    if (!this.motionPaused && this.onTickCallback) {
      this.onTickCallback(dt);
    }

    if (this.cameraFlight) {
      this.controls.autoRotate = false;
      const f = this.cameraFlight;
      f.elapsed = Math.min(f.duration, f.elapsed + dt);
      const t = f.duration > 0 ? f.elapsed / f.duration : 1;
      // Quintic smoothstep for zero-jerk ease-in and ease-out
      const eased = t * t * t * (t * (t * 6 - 15) + 10);

      this.flightQuat.setFromAxisAngle(f.rotAxis, f.angle * eased);
      this.flightVec.copy(f.startDir).applyQuaternion(this.flightQuat).normalize();
      const baseDist = THREE.MathUtils.lerp(f.startDist, f.endDist, eased);
      const arcBoost = Math.sin(Math.PI * eased) * f.arcLift;
      this.camera.position.copy(this.flightVec.multiplyScalar(baseDist + arcBoost));

      this.controls.target.lerpVectors(f.startTarget, f.endTarget, eased);

      const nextFov = THREE.MathUtils.lerp(f.startFov, f.endFov, eased);
      if (Math.abs(this.camera.fov - nextFov) > 0.01) {
        this.camera.fov = nextFov;
        this.camera.updateProjectionMatrix();
      }

      if (t >= 1) {
        this.cameraFlight = null;
      }
    } else {
      this.controls.autoRotate =
        this.autoOrbit && !this.motionPaused && !this.reducedMotion;

      const camRadius = this.camera.position.length();
      // Gently re-center pivot to Earth's core when pulling back to orbital overview
      if (camRadius > 19.5 && this.controls.target.lengthSq() > 0.0001) {
        const recenterFactor = THREE.MathUtils.clamp((camRadius - 19.5) / 8, 0, 1);
        const recenterAlpha = Math.min(1, dt * 3.5 * recenterFactor);
        this.controls.target.lerp(this.originVec, recenterAlpha);
      }

      const altNorm = THREE.MathUtils.clamp(
        (camRadius - (GLOBE_RADIUS + 1.2)) / 22.0,
        0,
        1
      );
      const desiredFov = THREE.MathUtils.lerp(46, 42, altNorm);
      if (Math.abs(this.camera.fov - desiredFov) > 0.02) {
        this.camera.fov = THREE.MathUtils.lerp(
          this.camera.fov,
          desiredFov,
          Math.min(1, dt * 6)
        );
        this.camera.updateProjectionMatrix();
      }
    }

    const camRadius = this.camera.position.length();
    const altNorm = THREE.MathUtils.clamp(
      (camRadius - (GLOBE_RADIUS + 1.0)) / 24.0,
      0,
      1
    );
    this.controls.rotateSpeed = THREE.MathUtils.lerp(0.24, 0.72, altNorm);
    this.controls.zoomSpeed = THREE.MathUtils.lerp(0.45, 0.95, altNorm);
    this.controls.autoRotateSpeed = THREE.MathUtils.lerp(0.16, 0.45, altNorm);
    this.controls.minDistance = Math.max(1.35, 10.65 - this.controls.target.length());
    this.controls.maxDistance = Math.max(
      24,
      42 - this.controls.target.length() * 0.4
    );

    const pulseTime = now * 0.004;
    for (const [, vis] of this.cableVisuals) {
      if (vis.shockwaveGroup.visible) {
        if (!this.motionPaused && !this.reducedMotion) {
          vis.cutShockAge += dt;
          const waveCycle = (vis.cutShockAge * 1.4) % 1;
          const scale = 1 + waveCycle * 5.2;
          vis.shockwaveRing.scale.setScalar(scale);
          (vis.shockwaveRing.material as THREE.MeshBasicMaterial).opacity =
            (1 - waveCycle) * 0.85;
          vis.faultBeacon.scale.setScalar(0.9 + 0.25 * Math.sin(pulseTime * 2));
        } else {
          vis.shockwaveRing.scale.setScalar(2.4);
          (vis.shockwaveRing.material as THREE.MeshBasicMaterial).opacity = 0.7;
          vis.faultBeacon.scale.setScalar(1.0);
        }
      }
    }

    if (this.showPulses && this.snapshot) {
      const stepFactor = this.motionPaused || this.reducedMotion ? 0 : dt;
      for (let i = 0; i < this.packets.length; i++) {
        const pkt = this.packets[i];
        const state = this.snapshot.cables.get(pkt.cableId);
        if (
          !state ||
          (state.cutState !== 'active' && state.cutState !== 'degraded')
        ) {
          this.dummy.scale.setScalar(0);
          this.dummy.updateMatrix();
          this.packetMesh.setMatrixAt(i, this.dummy.matrix);
          continue;
        }

        const isHighlighted = this.selectedCorridorCables.has(pkt.cableId);
        if (!isHighlighted && this.packetStride > 1 && i % this.packetStride !== 0) {
          this.dummy.scale.setScalar(0);
          this.dummy.updateMatrix();
          this.packetMesh.setMatrixAt(i, this.dummy.matrix);
          continue;
        }
        const speedBoost = isHighlighted ? 1.55 : 1.0;
        pkt.u += pkt.direction * pkt.speed * speedBoost * stepFactor;
        if (pkt.u > 1) pkt.u -= 1;
        if (pkt.u < 0) pkt.u += 1;

        const pt = pkt.curve.getPointAt(pkt.u);
        this.dummy.position.copy(pt);
        this.dummy.scale.setScalar(isHighlighted ? 1.45 : 0.9);
        this.dummy.updateMatrix();
        this.packetMesh.setMatrixAt(i, this.dummy.matrix);

        if (isHighlighted) {
          this.tmpColor.setHex(
            state.utilization >= 0.85 ? 0xfb7185 : 0xfef08a
          );
        } else if (state.utilization >= 0.85) {
          this.tmpColor.setHex(0xf97316);
        } else if (state.utilization >= 0.65) {
          this.tmpColor.setHex(0xfbbf24);
        } else {
          this.tmpColor.setHex(0x67e8f9);
        }
        this.packetMesh.setColorAt(i, this.tmpColor);
      }
      this.packetMesh.instanceMatrix.needsUpdate = true;
      if (this.packetMesh.instanceColor) {
        this.packetMesh.instanceColor.needsUpdate = true;
      }
    }

    this.controls.update();
    const minWorldRadius = GLOBE_RADIUS + 0.45;
    if (this.camera.position.lengthSq() < minWorldRadius * minWorldRadius) {
      this.camera.position.setLength(minWorldRadius);
    }
    this.renderer.render(this.scene, this.camera);
    this.emitProjectedMarkers();
  };

  private emitProjectedMarkers(): void {
    if (!this.callbacks.onMarkersUpdate || !this.snapshot) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (!width || !height) return;

    const markers: ProjectedMarker[] = [];
    const camPos = this.camera.position;

    const tryProject = (
      id: string,
      kind: ProjectedMarker['kind'],
      label: string,
      worldPos: THREE.Vector3
    ) => {
      const normal = worldPos.clone().normalize();
      const toCam = camPos.clone().sub(worldPos).normalize();
      if (normal.dot(toCam) < 0.08) return;

      const ndc = worldPos.clone().project(this.camera);
      if (ndc.z < -1 || ndc.z > 1) return;
      const x = (ndc.x * 0.5 + 0.5) * width;
      const y = (-ndc.y * 0.5 + 0.5) * height;
      if (x < 0 || x > width || y < 0 || y > height) return;
      markers.push({ id, kind, label, x, y });
    };

    if (this.endpointRoles.srcId) {
      const s = LANDING_STATIONS.find((x) => x.id === this.endpointRoles.srcId);
      if (s) {
        tryProject(
          `src-${s.id}`,
          'src',
          `SRC · ${s.city.toUpperCase()}`,
          latLonToVector3(s.lat, s.lon, GLOBE_RADIUS + 0.16)
        );
      }
    }

    if (this.endpointRoles.dstId) {
      const s = LANDING_STATIONS.find((x) => x.id === this.endpointRoles.dstId);
      if (s) {
        tryProject(
          `dst-${s.id}`,
          'dst',
          `DST · ${s.city.toUpperCase()}`,
          latLonToVector3(s.lat, s.lon, GLOBE_RADIUS + 0.16)
        );
      }
    }

    for (const [id, vis] of this.cableVisuals) {
      const st = this.snapshot.cables.get(id);
      if (!st) continue;
      if (st.cutState === 'severed') {
        const pt = vis.curve.getPointAt(
          THREE.MathUtils.clamp(st.cutProgressT, 0, 1)
        );
        const depthStr = st.faultDepthM
          ? ` (${Math.abs(st.faultDepthM)}m)`
          : '';
        tryProject(
          `fault-${id}`,
          'fault',
          `FAULT · ${vis.cable.systemCode}${depthStr}`,
          pt
        );
      } else if (st.cutState === 'repairing') {
        const phaseTag = st.repairPhase ? st.repairPhase.toUpperCase() : 'REPAIR';
        tryProject(
          `ship-${id}`,
          'ship',
          `${st.repairShip ?? 'CS'} · ${phaseTag} ${Math.round(
            st.repairProgress * 100
          )}%`,
          vis.repairShipMesh.position.clone()
        );
      }
    }

    this.callbacks.onMarkersUpdate(markers);
  }

  public dispose(): void {
    cancelAnimationFrame(this.animFrameId);
    this.resizeObserver.disconnect();
    this.updateHaloMesh('hovered', null);
    this.updateHaloMesh('inspected', null);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
