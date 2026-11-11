import './style.css';
import { telemetryAudio } from './audio/telemetryAudio';
import {
  LANDING_STATIONS,
  SCENARIO_PRESETS,
  SUBSEA_CABLES,
} from './data/networkData';
import {
  GlobeScene,
  type HoverInfo,
  type ProjectedMarker,
} from './globe/GlobeScene';
import { STATION_ASN_MAP } from './sim/bgpEngine';
import { computeSubseaRepairPlan } from './sim/repairEngine';
import { RoutingEngine } from './sim/routingEngine';
import {
  SubseaRovScene,
  type SubseaCameraMode,
} from './subsea/SubseaRovScene';
import type {
  FaultCause,
  NetworkSnapshot,
  TrafficCorridor,
} from './types/network';
import { renderSeabedAndOtdr } from './ui/seabedOtdrCanvas';

const engine = new RoutingEngine();
const stationById = new Map(LANDING_STATIONS.map((s) => [s.id, s]));

// DOM Elements
const appShell = document.getElementById('app')!;
appShell.dataset.viewMode = 'split';
const globeContainer = document.getElementById('globe-viewport')!;
const globeMarkersEl = document.getElementById('globe-markers')!;
const subseaRovContainer = document.getElementById('subsea-rov-viewport')!;
const subseaCableTitle = document.getElementById('subsea-cable-title')!;
const subseaStatusBadge = document.getElementById('subsea-status-badge')!;
const subseaDepthVal = document.getElementById('subsea-depth-val')!;
const subseaPressureVal = document.getElementById('subsea-pressure-val')!;
const subseaTempVal = document.getElementById('subsea-temp-val')!;
const subseaArmorVal = document.getElementById('subsea-armor-val')!;
const btnSubseaCut = document.getElementById(
  'btn-subsea-cut'
) as HTMLButtonElement;
const btnSubseaExpand = document.getElementById(
  'btn-subsea-expand'
) as HTMLButtonElement;
const subseaExpandLabel = document.getElementById('subsea-expand-label')!;
const viewModeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.view-mode-btn')
);
const subseaCamButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.subsea-cam-btn')
);

const globalStatusPill = document.getElementById('global-status-pill')!;
const kpiCapacity = document.getElementById('kpi-capacity')!;
const kpiRtt = document.getElementById('kpi-rtt')!;
const kpiSevered = document.getElementById('kpi-severed')!;
const kpiRerouted = document.getElementById('kpi-rerouted')!;

const btnAudio = document.getElementById('btn-audio') as HTMLButtonElement;
const audioLabel = document.getElementById('audio-label')!;
const btnPauseMotion = document.getElementById(
  'btn-pause-motion'
) as HTMLButtonElement;
const btnHudToggle = document.getElementById(
  'btn-hud-toggle'
) as HTMLButtonElement;
const btnRestoreAll = document.getElementById(
  'btn-restore-all'
) as HTMLButtonElement;

const faultCauseSelect = document.getElementById(
  'fault-cause-select'
) as HTMLSelectElement;
const scenarioList = document.getElementById('scenario-list')!;
const cameraPresets = document.getElementById('camera-presets')!;

const traceSrcSelect = document.getElementById('trace-src') as HTMLSelectElement;
const traceDstSelect = document.getElementById('trace-dst') as HTMLSelectElement;
const btnSwapTrace = document.getElementById('btn-swap-trace')!;
const traceStatusBadge = document.getElementById('trace-status-badge')!;
const traceRttEl = document.getElementById('trace-rtt')!;
const traceDeltaEl = document.getElementById('trace-delta')!;
const traceLossEl = document.getElementById('trace-loss')!;
const bgpRibBox = document.getElementById('bgp-rib-box')!;
const traceHopsChain = document.getElementById('trace-hops-chain')!;

const oceanOpacitySlider = document.getElementById(
  'ocean-opacity-slider'
) as HTMLInputElement;
const oceanOpacityVal = document.getElementById('ocean-opacity-val')!;
const chkPulses = document.getElementById('chk-pulses') as HTMLInputElement;
const chkRepeaters = document.getElementById('chk-repeaters') as HTMLInputElement;
const chkHazards = document.getElementById('chk-hazards') as HTMLInputElement;
const chkHeatmap = document.getElementById('chk-heatmap') as HTMLInputElement;
const chkTerminator = document.getElementById(
  'chk-terminator'
) as HTMLInputElement;
const chkOrbit = document.getElementById('chk-orbit') as HTMLInputElement;

const corridorsTbody = document.getElementById('corridors-tbody')!;
const otdrCableSelect = document.getElementById(
  'otdr-cable-select'
) as HTMLSelectElement;
const otdrProvenanceBadge = document.getElementById('otdr-provenance-badge')!;
const optFiberVal = document.getElementById('opt-fiber-val')!;
const optSpanVal = document.getElementById('opt-span-val')!;
const otdrOsnrEl = document.getElementById('otdr-osnr')!;
const optQVal = document.getElementById('opt-q-val')!;
const optBerVal = document.getElementById('opt-ber-val')!;
const optDispVal = document.getElementById('opt-disp-val')!;
const otdrPfeEl = document.getElementById('otdr-pfe')!;
const pfeCurrentVal = document.getElementById('pfe-current-val')!;
const otdrDepthEl = document.getElementById('otdr-depth')!;
const otdrNotesBox = document.getElementById('otdr-notes-box')!;
const seabedOtdrCanvas = document.getElementById(
  'seabed-otdr-canvas'
) as HTMLCanvasElement;
const btnDiveCable = document.getElementById(
  'btn-dive-cable'
) as HTMLButtonElement;
const btnOtdrAction = document.getElementById(
  'btn-otdr-action'
) as HTMLButtonElement;

const repairSummaryBox = document.getElementById('repair-summary-box')!;
const repairStepsList = document.getElementById('repair-steps-list')!;
const cableSearchInput = document.getElementById(
  'cable-search'
) as HTMLInputElement;
const cablesList = document.getElementById('cables-list')!;
const eventsList = document.getElementById('events-list')!;
const tooltipEl = document.getElementById('globe-tooltip')!;
const announcerEl = document.getElementById('live-announcer')!;

// App State
let activeScenarioId: string | null = null;
let selectedCorridorId: string = 'mba-mrs';
let inspectedCableId: string = 'aae1-redsea';
let nextStationTarget: 'src' | 'dst' = 'dst';
let motionPaused = false;
let currentSnapshot: NetworkSnapshot = engine.computeSnapshot();
let repairTickAccumulator = 0;

function announce(msg: string): void {
  announcerEl.textContent = '';
  requestAnimationFrame(() => {
    announcerEl.textContent = msg;
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Initialize 3D Underwater ROV & Seabed Floor Simulation
const subseaRov = new SubseaRovScene(subseaRovContainer);

// Initialize 3D Globe
const globe = new GlobeScene(globeContainer, {
  onCableClick: (cableId, cutCoord, progressT) => {
    const state = currentSnapshot.cables.get(cableId);
    const cable = SUBSEA_CABLES.find((c) => c.id === cableId);
    if (!state || !cable) return;

    activeScenarioId = null;
    inspectedCableId = cableId;
    otdrCableSelect.value = cableId;

    if (state.cutState === 'active') {
      engine.severCable(cableId, cutCoord, progressT);
      globe.triggerShockwave(cableId);
      telemetryAudio.playCableCut();
      setTimeout(() => telemetryAudio.playRerouteChirp(), 240);
      announce(`Cable fault injected on ${cable.name}.`);
    } else if (state.cutState === 'severed' || state.cutState === 'degraded') {
      engine.dispatchRepairShip(cableId);
      telemetryAudio.playRerouteChirp();
      announce(`Repair vessel mobilized for ${cable.name}.`);
    } else {
      engine.restoreCable(cableId);
      telemetryAudio.playRepairSplice();
      announce(`Service restoration complete on ${cable.name}.`);
    }
    syncUI();
  },

  onStationClick: (stationId) => {
    const station = stationById.get(stationId);
    if (!station) return;
    telemetryAudio.playHoverTick();

    if (nextStationTarget === 'src') {
      if (stationId !== traceDstSelect.value) {
        traceSrcSelect.value = stationId;
      }
      nextStationTarget = 'dst';
    } else {
      if (stationId !== traceSrcSelect.value) {
        traceDstSelect.value = stationId;
      }
      nextStationTarget = 'src';
    }
    engine.setCustomTraceEndpoints(traceSrcSelect.value, traceDstSelect.value);
    selectedCorridorId = 'custom-trace';
    syncUI();
    announce(`BGP path inspection updated to ${station.city}.`);
  },

  onHoverChange: (info) => {
    renderTooltip(info);
  },

  onMarkersUpdate: (markers) => {
    renderProjectedMarkers(markers);
  },
});

globe.setOnTick((dt) => {
  const completed = engine.tickRepairs(dt);
  if (completed.length > 0) {
    telemetryAudio.playRepairSplice();
    syncUI();
    announce(`Service restored on: ${completed.join(', ')}`);
    return;
  }

  if (currentSnapshot.repairingCount > 0) {
    repairTickAccumulator += dt;
    if (repairTickAccumulator >= 0.25) {
      repairTickAccumulator = 0;
      currentSnapshot = engine.computeSnapshot();
      const highlighted = getHighlightedTrace();
      globe.updateSnapshot(
        currentSnapshot,
        highlighted?.currentCables ?? [],
        highlighted ? [highlighted.srcId, highlighted.dstId] : []
      );
      renderCablesList();
      renderSeabedOtdrPanel();
      renderRepairPanel();
    }
  }
});

// Populate Selectors & Scenarios
function initStaticControls(): void {
  const sortedStations = [...LANDING_STATIONS].sort((a, b) =>
    a.city.localeCompare(b.city)
  );
  for (const s of sortedStations) {
    const asn = STATION_ASN_MAP[s.id]?.asn ?? 65000;
    const opt1 = document.createElement('option');
    opt1.value = s.id;
    opt1.textContent = `${s.city} (AS${asn})`;
    traceSrcSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = s.id;
    opt2.textContent = `${s.city} (AS${asn})`;
    traceDstSelect.appendChild(opt2);
  }
  traceSrcSelect.value = 'mombasa';
  traceDstSelect.value = 'marseille';
  engine.setCustomTraceEndpoints('mombasa', 'marseille');

  for (const c of SUBSEA_CABLES) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.systemCode} — ${c.name} (${c.lengthKm.toLocaleString()} km)`;
    otdrCableSelect.appendChild(opt);
  }
  otdrCableSelect.value = inspectedCableId;

  for (const preset of SCENARIO_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scenario-btn';
    btn.dataset.scenarioId = preset.id;
    btn.innerHTML = `
      <span class="scenario-title">[${escapeHtml(preset.category)}] ${escapeHtml(preset.name)}</span>
      <span class="scenario-desc">${escapeHtml(preset.subtitle)}</span>
    `;
    btn.addEventListener('click', () => {
      activeScenarioId = preset.id;
      engine.applyScenario(
        preset.cableIdsToCut,
        preset.name,
        preset.cause,
        preset.subsystemFaultMode,
        preset.bgpConfig
      );
      preset.cableIdsToCut.forEach((id) => globe.triggerShockwave(id));
      telemetryAudio.playCableCut();
      setTimeout(() => telemetryAudio.playRerouteChirp(), 260);
      globe.flyTo(preset.focusLatLon[0], preset.focusLatLon[1], 19.5);

      if (preset.cableIdsToCut.length > 0) {
        inspectedCableId = preset.cableIdsToCut[0];
        otdrCableSelect.value = inspectedCableId;
      }

      const suggested = currentSnapshot.corridors.find(
        (c) => c.id === preset.suggestedCorridorId
      );
      if (suggested) {
        traceSrcSelect.value = suggested.srcId;
        traceDstSelect.value = suggested.dstId;
        engine.setCustomTraceEndpoints(suggested.srcId, suggested.dstId);
        selectedCorridorId = suggested.id;
      }
      syncUI();
      announce(`Scenario applied: ${preset.name}`);
    });
    scenarioList.appendChild(btn);
  }
}

function getHighlightedTrace(): TrafficCorridor | null {
  if (selectedCorridorId === 'custom-trace') {
    return currentSnapshot.customTrace;
  }
  return (
    currentSnapshot.corridors.find((c) => c.id === selectedCorridorId) ??
    currentSnapshot.customTrace
  );
}

function syncUI(): void {
  currentSnapshot = engine.computeSnapshot();
  const highlighted = getHighlightedTrace();
  globe.updateSnapshot(
    currentSnapshot,
    highlighted?.currentCables ?? [],
    highlighted ? [highlighted.srcId, highlighted.dstId] : []
  );

  renderHeaderKPIs();
  renderScenarioButtons();
  renderTraceroute();
  renderCorridorsTable();
  renderSeabedOtdrPanel();
  renderRepairPanel();
  renderCablesList();
  renderEventsLog();
}

function renderHeaderKPIs(): void {
  const s = currentSnapshot;
  kpiCapacity.textContent = `${s.totalActiveTbps.toLocaleString()} / ${s.totalDesignTbps.toLocaleString()} Tbps`;
  const rttDelta = s.meanGlobalRttMs - s.baselineMeanRttMs;
  kpiRtt.textContent =
    rttDelta > 0.2
      ? `${s.meanGlobalRttMs.toFixed(1)} ms (+${rttDelta.toFixed(1)})`
      : `${s.meanGlobalRttMs.toFixed(1)} ms`;
  kpiRtt.className = `kpi-value ${
    rttDelta > 30 ? 'danger' : rttDelta > 5 ? 'warn' : ''
  }`;

  const totalFaulted = s.severedCount + s.degradedCount + s.repairingCount;
  kpiSevered.textContent = `${s.severedCount} LOS / ${s.degradedCount} DEG`;
  kpiSevered.className = `kpi-value ${
    s.severedCount > 0 ? 'danger' : s.degradedCount > 0 ? 'warn' : ''
  }`;

  kpiRerouted.textContent = String(s.reroutedCount + s.partitionedCount);
  kpiRerouted.className = `kpi-value ${
    s.partitionedCount > 0 ? 'danger' : s.reroutedCount > 0 ? 'warn' : ''
  }`;

  if (s.partitionedCount > 0) {
    globalStatusPill.textContent = 'BGP UNREACHABLE';
    globalStatusPill.className = 'status-pill status-critical';
  } else if (totalFaulted > 0 || s.reroutedCount > 0) {
    globalStatusPill.textContent = 'DEGRADED / REROUTED';
    globalStatusPill.className = 'status-pill status-degraded';
  } else {
    globalStatusPill.textContent = 'CONVERGED';
    globalStatusPill.className = 'status-pill status-optimal';
  }
}

function renderScenarioButtons(): void {
  const buttons = scenarioList.querySelectorAll<HTMLButtonElement>('.scenario-btn');
  buttons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scenarioId === activeScenarioId);
  });
}

function renderTraceroute(): void {
  const trace = currentSnapshot.customTrace;
  if (!trace) {
    traceStatusBadge.textContent = 'SELECT';
    traceStatusBadge.className = 'badge badge-optimal';
    traceRttEl.textContent = '-- ms';
    traceDeltaEl.textContent = '--';
    traceLossEl.textContent = '--';
    bgpRibBox.textContent = 'Select distinct origin and destination CLS hubs.';
    traceHopsChain.textContent = '';
    return;
  }

  traceStatusBadge.textContent = trace.status;
  traceStatusBadge.className = `badge badge-${trace.status.toLowerCase()}`;

  const srcMeta = STATION_ASN_MAP[trace.srcId];
  const dstMeta = STATION_ASN_MAP[trace.dstId];

  if (trace.status === 'POLICY_BLOCKED') {
    traceRttEl.textContent = 'FILTERED';
    traceDeltaEl.textContent = 'NO_EXPORT';
    traceLossEl.textContent = '100% / --';
    bgpRibBox.textContent = `RFC 4271 Loc-RIB: NONE | Physical Path: ACTIVE | Rejected by AS37457 NO_EXPORT / Valley-Free export filter.`;
    traceHopsChain.textContent = `Physical capacity exists between AS${srcMeta?.asn} and AS${dstMeta?.asn}, but BGP policy filtered all candidate advertisements.`;
    return;
  }

  if (trace.status === 'PARTITIONED' || !trace.bgpRoute) {
    traceRttEl.textContent = 'WITHDRAWN';
    traceDeltaEl.textContent = 'LOS';
    traceLossEl.textContent = '100% / --';
    bgpRibBox.textContent = `RFC 4271 Loc-RIB: Route withdrawn (${dstMeta?.ipv4Prefix ?? ''}). Physical & BGP reachability lost.`;
    traceHopsChain.textContent =
      'All optical trunks or border router sessions on candidate paths are down.';
    return;
  }

  const delta = trace.currentRttMs - trace.baselineRttMs;
  traceRttEl.textContent = `${trace.currentRttMs.toFixed(1)} ms`;
  traceDeltaEl.textContent =
    delta > 0.1 ? `+${delta.toFixed(1)} ms` : '0.0 ms';
  traceLossEl.textContent = `${trace.packetLossPct}% / ${trace.jitterMs}ms`;

  const r = trace.bgpRoute;
  const asPathStr = r.asPath.map((asn) => `AS${asn}`).join(' ');
  const commStr = r.communities.join(' ');
  bgpRibBox.textContent = `Prefix ${r.prefix} | LOCAL_PREF ${r.localPref} | MED ${r.med} | AS_PATH [${asPathStr}] | Comm: ${commStr}`;

  const pathLabels = trace.currentPath.map(
    (id) => stationById.get(id)?.city ?? id
  );
  const cableCodes = trace.currentCables.map(
    (id) => SUBSEA_CABLES.find((c) => c.id === id)?.systemCode ?? id
  );

  const segments: string[] = [];
  for (let i = 0; i < pathLabels.length; i++) {
    segments.push(pathLabels[i]);
    if (i < cableCodes.length) {
      segments.push(`[${cableCodes[i]}]`);
    }
  }
  traceHopsChain.textContent = `FIB Data Plane: ${segments.join(' -> ')}`;
}

function renderCorridorsTable(): void {
  corridorsTbody.innerHTML = '';
  for (const c of currentSnapshot.corridors) {
    const tr = document.createElement('tr');
    tr.className = `corridor-row ${
      selectedCorridorId === c.id ? 'selected' : ''
    }`;
    tr.tabIndex = 0;

    const delta = c.currentRttMs - c.baselineRttMs;
    const liveCell =
      c.status === 'PARTITIONED' || c.status === 'POLICY_BLOCKED'
        ? `<span class="delta-bad">${c.status === 'POLICY_BLOCKED' ? 'POLICY' : 'DOWN'}</span>`
        : `${c.currentRttMs.toFixed(1)} ms${
            delta > 0.3
              ? `<span class="${delta > 40 ? 'delta-bad' : 'delta-up'}">+${delta.toFixed(0)}</span>`
              : ''
          }`;

    tr.innerHTML = `
      <th scope="row">${escapeHtml(c.label)}</th>
      <td class="mono-cell">${c.baselineRttMs.toFixed(1)} ms</td>
      <td class="mono-cell">${liveCell}</td>
      <td><span class="badge badge-${c.status.toLowerCase()}">${c.status}</span></td>
    `;

    const selectCorridor = () => {
      selectedCorridorId = c.id;
      traceSrcSelect.value = c.srcId;
      traceDstSelect.value = c.dstId;
      engine.setCustomTraceEndpoints(c.srcId, c.dstId);
      if (c.currentCables.length > 0) {
        inspectedCableId = c.currentCables[0];
        otdrCableSelect.value = inspectedCableId;
      }
      const src = stationById.get(c.srcId);
      const dst = stationById.get(c.dstId);
      if (src && dst) {
        globe.flyTo((src.lat + dst.lat) / 2, (src.lon + dst.lon) / 2, 24);
      }
      syncUI();
    };

    tr.addEventListener('click', selectCorridor);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectCorridor();
      }
    });

    corridorsTbody.appendChild(tr);
  }
}

function renderSeabedOtdrPanel(): void {
  const cable = SUBSEA_CABLES.find((c) => c.id === inspectedCableId);
  const st = currentSnapshot.cables.get(inspectedCableId);
  if (!cable || !st) return;

  const opt = st.optical;
  const pfe = st.pfe;
  const otdr = st.otdr;
  const prov = st.provenance;
  const seabed = st.seabedSample;

  otdrProvenanceBadge.textContent = `${prov.routeConfidence} · ${opt.fiberStandard} (${prov.fiberPairs} FP)`;

  optFiberVal.textContent = `${opt.fiberAttenuationDbPerKm} dB/km (${opt.spanCount}x${opt.spanLengthKm}km)`;
  optSpanVal.textContent = `${opt.spanLossDb} dB / +${opt.edfaGainDb} dB (NF ${opt.edfaNoiseFigureDb}dB)`;
  otdrOsnrEl.textContent = opt.opticalCarrierUp
    ? `${opt.gsnrDb} dB (ASE ${opt.osnrLinDb}dB)`
    : `0.0 dB (LOS)`;
  optQVal.textContent = opt.opticalCarrierUp
    ? `Q ${opt.qFactorDb} dB (EOL +${opt.eolMarginDb}dB)`
    : `Q 0.0 dB (BELOW FEC)`;
  optBerVal.textContent = opt.opticalCarrierUp
    ? `${opt.preFecBer} -> ${opt.postFecBer}`
    : `5.0e-1 (LOF/LOS)`;
  optDispVal.textContent = `${opt.chromaticDispersionPsNm.toLocaleString()} ps/nm · ${opt.pmdPs} ps`;

  if (cable.isTerrestrial) {
    otdrPfeEl.textContent = 'LOCAL AC/DC GRID';
    pfeCurrentVal.textContent = `Terrestrial Duct (${st.repeaterCount} ILA)`;
  } else if (pfe.mode === 'double-end-bipolar') {
    otdrPfeEl.textContent = `+${pfe.terminalAVoltageKv} / ${pfe.terminalBVoltageKv} kV`;
    pfeCurrentVal.textContent = `${pfe.lineCurrentAmps} A · ${pfe.conductorResistanceOhmKm} Ω/km (${pfe.totalWetPlantPowerKw} kW)`;
  } else if (pfe.mode === 'single-end-reconfig') {
    otdrPfeEl.textContent = `RECONFIG ${pfe.terminalAVoltageKv}/${pfe.terminalBVoltageKv} kV`;
    pfeCurrentVal.textContent = `${pfe.lineCurrentAmps} A · 0V @ ${pfe.zeroVoltPositionKm}km`;
  } else {
    otdrPfeEl.textContent = '0.0 kV (HVDC TRIP)';
    pfeCurrentVal.textContent = `0.00 A · R_tot ${pfe.totalCableResistanceOhm} Ω`;
  }

  if (st.cutState === 'severed' || st.cutState === 'degraded') {
    otdrDepthEl.textContent = `${otdr.estimatedFaultDistanceKm} ±${otdr.uncertaintyPlusMinusKm} km (${otdr.confidencePct}%)`;
    btnOtdrAction.textContent = 'Mobilize Repair Vessel';
    btnOtdrAction.className = 'cable-action-btn repair';
  } else if (st.cutState === 'repairing') {
    const plan = st.repairPlan;
    otdrDepthEl.textContent = plan
      ? `Step ${plan.currentStepIndex + 1}/15 · ETR ${plan.remainingHours}h`
      : `${Math.round(st.repairProgress * 100)}%`;
    btnOtdrAction.textContent = 'Complete Splice & Turn-Up';
    btnOtdrAction.className = 'cable-action-btn splice';
  } else {
    otdrDepthEl.textContent = `NOMINAL (Max ${cable.depthMaxM.toLocaleString()}m)`;
    btnOtdrAction.textContent = 'Inject Fault';
    btnOtdrAction.className = 'cable-action-btn cut';
  }

  otdrNotesBox.textContent = otdr.localizationNotes;

  renderSeabedAndOtdr(seabedOtdrCanvas, cable, st);

  // Sync 3D Underwater ROV & Ocean-Floor Simulation Stage with calculated physics
  subseaRov.updateInspection(cable, st);
  subseaCableTitle.textContent = `${cable.systemCode} — ${cable.name}`;

  const absDepthM = Math.abs(st.faultDepthM ?? seabed.depthM);
  const pressureMpa = 0.101 + absDepthM * 0.01008;
  const pressureBar = Math.round(pressureMpa * 10);

  subseaDepthVal.textContent = cable.isTerrestrial
    ? `Terrestrial Conduit (${seabed.actualBurialDepthM} m trench)`
    : `${absDepthM.toLocaleString()} m (${prov.maintenanceZone})`;
  subseaPressureVal.textContent = cable.isTerrestrial
    ? '0.10 MPa (Atmospheric)'
    : `${pressureMpa.toFixed(1)} MPa (${pressureBar} bar) [Calc]`;
  subseaTempVal.textContent = `${seabed.armorClass} · Burial ${seabed.actualBurialDepthM}m (Target ${seabed.targetBurialDepthM}m)`;
  subseaArmorVal.textContent = `${seabed.sediment} · ${st.repeaterCount} EDFA Pods`;

  if (st.cutState === 'severed') {
    subseaStatusBadge.textContent = `OPTICAL LOS · ${st.faultCause?.toUpperCase()}`;
    subseaStatusBadge.className = 'badge badge-partitioned';
    btnSubseaCut.textContent = 'Mobilize Repair Vessel';
    btnSubseaCut.className = 'cable-action-btn repair';
  } else if (st.cutState === 'degraded') {
    subseaStatusBadge.textContent = `DEGRADED · ${st.pfe.mode.toUpperCase()} · Q=${opt.qFactorDb}dB`;
    subseaStatusBadge.className = 'badge badge-rerouted';
    btnSubseaCut.textContent = 'Mobilize Repair Vessel';
    btnSubseaCut.className = 'cable-action-btn repair';
  } else if (st.cutState === 'repairing') {
    const stepCode = st.repairPlan?.currentStep.code ?? 'REPAIR';
    subseaStatusBadge.textContent = `${stepCode} (${Math.round(
      st.repairProgress * 100
    )}%)`;
    subseaStatusBadge.className = 'badge badge-rerouted';
    btnSubseaCut.textContent = 'Complete Splice';
    btnSubseaCut.className = 'cable-action-btn splice';
  } else {
    subseaStatusBadge.textContent = `CARRIER UP · GSNR ${opt.gsnrDb}dB · Q ${opt.qFactorDb}dB`;
    subseaStatusBadge.className = 'badge badge-optimal';
    btnSubseaCut.textContent = 'Inject Fault';
    btnSubseaCut.className = 'cable-action-btn cut';
  }
}

function renderRepairPanel(): void {
  const cable = SUBSEA_CABLES.find((c) => c.id === inspectedCableId);
  const st = currentSnapshot.cables.get(inspectedCableId);
  if (!cable || !st) return;

  const coord =
    st.cutCoord ?? cable.waypoints[Math.floor(cable.waypoints.length / 2)];
  const plan =
    st.repairPlan ??
    computeSubseaRepairPlan(
      cable,
      coord,
      st.cutState === 'repairing' ? st.repairProgress : 0
    );

  const stateTag =
    st.cutState === 'repairing'
      ? `ACTIVE OPERATION (${plan.elapsedHours}h / ${plan.totalEstimatedHours}h elapsed)`
      : st.cutState === 'severed' || st.cutState === 'degraded'
      ? `AWAITING DISPATCH (Est. Total Duration: ${plan.totalEstimatedHours} hours)`
      : `STANDBY ENGINEERING ESTIMATE (If faulted at midpoint: ${plan.totalEstimatedHours} hours)`;

  repairSummaryBox.textContent = `${stateTag} | Assigned Vessel: ${plan.vessel.name} (${plan.vessel.operator}, Depot: ${plan.vessel.depotCity}, ${plan.transitDistanceNm} NM) | Depth: ${plan.waterDepthM}m | Burial: ${plan.burialDepthM}m | Sea State: Beaufort ${plan.seaStateBeaufort} (${plan.significantWaveHeightM}m) | Method: ${plan.recoveryMethod} | Spare Bight: ${plan.spareCableInsertedKm} km (${plan.universalJointCount}x UJ)`;

  repairStepsList.innerHTML = '';
  for (const step of plan.steps) {
    const li = document.createElement('li');
    const isCurrent =
      st.cutState === 'repairing' &&
      step.stepNumber === plan.currentStep.stepNumber;
    const isDone =
      st.cutState === 'repairing' &&
      step.stepNumber < plan.currentStep.stepNumber;
    li.className = `event-item ${
      isCurrent ? 'warning' : isDone ? 'recovery' : 'info'
    }`;
    li.innerHTML = `
      <div class="event-head">
        <span class="event-code">${escapeHtml(step.code)} · ${escapeHtml(step.label)}</span>
        <span>${step.durationHours}h (Cum. ${step.cumulativeHours}h)</span>
      </div>
      <div class="event-msg">${escapeHtml(step.engineeringDetail)}</div>
    `;
    repairStepsList.appendChild(li);
  }
}

function renderCablesList(): void {
  const query = cableSearchInput.value.trim().toLowerCase();
  cablesList.innerHTML = '';

  const filtered = SUBSEA_CABLES.filter((c) => {
    if (!query) return true;
    return (
      c.name.toLowerCase().includes(query) ||
      c.systemCode.toLowerCase().includes(query) ||
      c.corridorTag.toLowerCase().includes(query) ||
      c.owners.toLowerCase().includes(query)
    );
  });

  filtered.sort((a, b) => {
    const sa = currentSnapshot.cables.get(a.id)?.cutState ?? 'active';
    const sb = currentSnapshot.cables.get(b.id)?.cutState ?? 'active';
    const weight = (s: string) =>
      s === 'severed' ? 0 : s === 'degraded' ? 1 : s === 'repairing' ? 2 : 3;
    return weight(sa) - weight(sb);
  });

  for (const cable of filtered) {
    const st = currentSnapshot.cables.get(cable.id)!;
    const utilPct = Math.min(100, Math.round(st.utilization * 100));
    const card = document.createElement('div');
    card.className = `cable-card ${st.cutState}`;

    const utilClass =
      st.utilization >= 0.9 ? 'over' : st.utilization >= 0.68 ? 'high' : '';

    let statusText = `${utilPct}% (${st.carriedTbps}/${cable.capacityTbps} Tbps) · GSNR ${st.osnrDb}dB · Q ${st.optical.qFactorDb}dB`;
    if (st.cutState === 'severed') {
      statusText = `LOS (${st.faultCause}) @ ${st.faultDistanceKm}±${st.faultUncertaintyKm}km (${Math.abs(
        st.faultDepthM ?? cable.depthMaxM
      )}m)`;
    } else if (st.cutState === 'degraded') {
      statusText = `DEGRADED (${st.faultCause}) · ${st.pfe.mode} · Q=${st.optical.qFactorDb}dB`;
    } else if (st.cutState === 'repairing') {
      statusText = `${st.repairShip} · ${st.repairPlan?.currentStep.code ?? 'REPAIR'} (${
        st.repairPlan?.remainingHours ?? 0
      }h rem)`;
    }

    card.innerHTML = `
      <div class="cable-card-top">
        <div>
          <div class="cable-name">${escapeHtml(cable.name)}</div>
          <div class="cable-meta">${escapeHtml(cable.systemCode)} · RFS ${cable.rfsYear} · ${cable.lengthKm.toLocaleString()} km · ${st.repeaterCount} EDFA · ${st.provenance.routeConfidence}</div>
        </div>
      </div>
      <div class="util-bar" aria-hidden="true">
        <div class="util-fill ${utilClass}" style="inline-size: ${
          st.cutState === 'repairing'
            ? Math.round(st.repairProgress * 100)
            : st.cutState === 'severed'
            ? 0
            : utilPct
        }%"></div>
      </div>
      <div class="cable-card-actions">
        <span class="cable-meta">${escapeHtml(statusText)}</span>
        <div style="display:flex; gap:6px;"></div>
      </div>
    `;

    const actionWrap = card.querySelector('.cable-card-actions > div')!;
    const inspectBtn = document.createElement('button');
    inspectBtn.type = 'button';
    inspectBtn.className = 'cable-action-btn';
    inspectBtn.textContent = 'Inspect';
    inspectBtn.addEventListener('click', () => {
      inspectedCableId = cable.id;
      otdrCableSelect.value = cable.id;
      const target =
        st.cutCoord ?? cable.waypoints[Math.floor(cable.waypoints.length / 2)];
      globe.diveTo(target[0], target[1]);
      renderSeabedOtdrPanel();
      renderRepairPanel();
    });
    actionWrap.appendChild(inspectBtn);

    if (st.cutState === 'active') {
      const cutBtn = document.createElement('button');
      cutBtn.type = 'button';
      cutBtn.className = 'cable-action-btn cut';
      cutBtn.textContent = 'Fault';
      cutBtn.addEventListener('click', () => {
        activeScenarioId = null;
        inspectedCableId = cable.id;
        otdrCableSelect.value = cable.id;
        engine.severCable(cable.id);
        globe.triggerShockwave(cable.id);
        telemetryAudio.playCableCut();
        const mid = cable.waypoints[Math.floor(cable.waypoints.length / 2)];
        globe.diveTo(mid[0], mid[1]);
        syncUI();
      });
      actionWrap.appendChild(cutBtn);
    } else if (st.cutState === 'severed' || st.cutState === 'degraded') {
      const shipBtn = document.createElement('button');
      shipBtn.type = 'button';
      shipBtn.className = 'cable-action-btn repair';
      shipBtn.textContent = 'Mobilize Ship';
      shipBtn.addEventListener('click', () => {
        engine.dispatchRepairShip(cable.id);
        telemetryAudio.playRerouteChirp();
        syncUI();
      });
      const spliceBtn = document.createElement('button');
      spliceBtn.type = 'button';
      spliceBtn.className = 'cable-action-btn splice';
      spliceBtn.textContent = 'Restore';
      spliceBtn.addEventListener('click', () => {
        engine.restoreCable(cable.id);
        telemetryAudio.playRepairSplice();
        syncUI();
      });
      actionWrap.appendChild(shipBtn);
      actionWrap.appendChild(spliceBtn);
    } else {
      const spliceBtn = document.createElement('button');
      spliceBtn.type = 'button';
      spliceBtn.className = 'cable-action-btn splice';
      spliceBtn.textContent = 'Complete';
      spliceBtn.addEventListener('click', () => {
        engine.restoreCable(cable.id);
        telemetryAudio.playRepairSplice();
        syncUI();
      });
      actionWrap.appendChild(spliceBtn);
    }

    cablesList.appendChild(card);
  }
}

function renderEventsLog(): void {
  eventsList.innerHTML = '';
  for (const evt of engine.getEvents()) {
    const li = document.createElement('li');
    li.className = `event-item ${evt.severity}`;
    li.innerHTML = `
      <div class="event-head">
        <span class="event-code">${escapeHtml(evt.code)}</span>
        <span>${escapeHtml(evt.timestamp)}</span>
      </div>
      <div class="event-msg">${escapeHtml(evt.message)}</div>
    `;
    eventsList.appendChild(li);
  }
}

function renderTooltip(info: HoverInfo | null): void {
  if (!info) {
    tooltipEl.hidden = true;
    return;
  }

  if (info.kind === 'station' && info.station) {
    const s = info.station;
    const asMeta = STATION_ASN_MAP[s.id];
    tooltipEl.innerHTML = `
      <div class="tooltip-title">${escapeHtml(s.name)} (AS${asMeta?.asn ?? 65000})</div>
      <div class="tooltip-sub">${escapeHtml(s.city)}, ${escapeHtml(s.country)} · ${escapeHtml(asMeta?.asName ?? '')}</div>
      <div class="tooltip-meta">Prefix: ${escapeHtml(asMeta?.ipv4Prefix ?? '')} · IXPs: ${escapeHtml(s.ixps.join(', '))}</div>
      <div class="tooltip-hint">Click to set BGP inspection ${
        nextStationTarget === 'src' ? 'origin' : 'destination'
      }</div>
    `;
  } else if (info.kind === 'cable' && info.cable && info.runtime) {
    const c = info.cable;
    const r = info.runtime;
    const depthLabel =
      info.depthM && info.depthM < 0
        ? `Bathymetry ${Math.abs(info.depthM).toLocaleString()}m (Est.)`
        : `Terrestrial Conduit`;
    const statusLine =
      r.cutState === 'severed'
        ? `OPTICAL LOS (${r.faultCause}) · Est. ${r.faultDistanceKm}±${r.faultUncertaintyKm} km`
        : r.cutState === 'degraded'
        ? `DEGRADED (${r.faultCause}) · PFE ${r.pfe.mode} · Q=${r.optical.qFactorDb} dB`
        : r.cutState === 'repairing'
        ? `${r.repairShip} · ${r.repairPlan?.currentStep.code ?? 'REPAIR'} (${
            r.repairPlan?.remainingHours ?? 0
          }h rem)`
        : `Load ${Math.round(r.utilization * 100)}% (${r.carriedTbps}/${
            c.capacityTbps
          } Tbps) · GSNR ${r.osnrDb}dB · Q ${r.optical.qFactorDb}dB`;

    tooltipEl.innerHTML = `
      <div class="tooltip-title">${escapeHtml(c.name)}</div>
      <div class="tooltip-sub">${escapeHtml(c.systemCode)} · ${c.lengthKm.toLocaleString()} km · ${depthLabel}</div>
      <div class="tooltip-meta">${escapeHtml(statusLine)}</div>
      <div class="tooltip-meta">Provenance: ${r.provenance.routeConfidence} (${escapeHtml(c.owners)})</div>
    `;
  }

  tooltipEl.hidden = false;
  const pad = 16;
  const rect = tooltipEl.getBoundingClientRect();
  const left = Math.min(window.innerWidth - rect.width - pad, info.x + 14);
  const top = Math.min(window.innerHeight - rect.height - pad, info.y + 14);
  tooltipEl.style.left = `${Math.max(pad, left)}px`;
  tooltipEl.style.top = `${Math.max(pad, top)}px`;
}

// Accessible Tablist Controller
function setupTabs(): void {
  const tabs = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  );
  const panels = Array.from(
    document.querySelectorAll<HTMLElement>('[role="tabpanel"]')
  );

  const activateTab = (tab: HTMLButtonElement, moveFocus = false) => {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
    });

    panels.forEach((panel) => {
      const match = panel.getAttribute('aria-labelledby') === tab.id;
      if (match) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', 'until-found');
      }
    });

    if (tab.id === 'tab-seabed') {
      requestAnimationFrame(() => renderSeabedOtdrPanel());
    } else if (tab.id === 'tab-repair') {
      requestAnimationFrame(() => renderRepairPanel());
    }

    if (moveFocus) tab.focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (e) => {
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (index + 1) % tabs.length;
      else if (e.key === 'ArrowLeft')
        nextIdx = (index - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;

      if (nextIdx >= 0) {
        e.preventDefault();
        activateTab(tabs[nextIdx], true);
      }
    });
  });

  panels.forEach((panel) => {
    panel.addEventListener('beforematch', () => {
      const labelId = panel.getAttribute('aria-labelledby');
      const ownerTab = tabs.find((t) => t.id === labelId);
      if (ownerTab) activateTab(ownerTab);
    });
  });
}

// Event Bindings
btnAudio.addEventListener('click', () => {
  const next = !telemetryAudio.isEnabled();
  telemetryAudio.setEnabled(next);
  btnAudio.setAttribute('aria-pressed', String(next));
  audioLabel.textContent = next ? 'Audio: On' : 'Audio: Muted';
  if (next) telemetryAudio.playHoverTick();
});

btnPauseMotion.addEventListener('click', () => {
  motionPaused = !motionPaused;
  globe.setMotionPaused(motionPaused);
  subseaRov.setMotionPaused(motionPaused);
  const labelSpan = btnPauseMotion.querySelector('span')!;
  labelSpan.textContent = motionPaused ? 'Resume' : 'Pause';
});

function setViewMode(mode: 'split' | 'subsea' | 'globe'): void {
  appShell.dataset.viewMode = mode;
  viewModeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.viewMode === mode);
  });
  subseaExpandLabel.textContent =
    mode === 'subsea' ? 'Split View' : 'Maximize 3D';
}

viewModeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = (btn.dataset.viewMode as 'split' | 'subsea' | 'globe') ?? 'split';
    setViewMode(mode);
  });
});

btnSubseaExpand.addEventListener('click', () => {
  const next = appShell.dataset.viewMode === 'subsea' ? 'split' : 'subsea';
  setViewMode(next);
});

subseaCamButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const camMode = (btn.dataset.camMode as SubseaCameraMode) ?? 'orbit';
    subseaCamButtons.forEach((b) => b.classList.toggle('active', b === btn));
    subseaRov.setCameraMode(camMode);
  });
});

btnSubseaCut.addEventListener('click', () => {
  btnOtdrAction.click();
});

btnHudToggle.addEventListener('click', () => {
  const collapsed = appShell.classList.toggle('hud-collapsed');
  btnHudToggle.setAttribute('aria-expanded', String(!collapsed));
});

btnRestoreAll.addEventListener('click', () => {
  activeScenarioId = null;
  const restored = engine.restoreAll();
  if (restored > 0) {
    telemetryAudio.playRepairSplice();
  }
  announce('Restored deterministic network baseline.');
  syncUI();
});

faultCauseSelect.addEventListener('change', () => {
  engine.setSelectedFaultCause(faultCauseSelect.value as FaultCause | 'Auto');
});

cameraPresets.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pill-btn');
  if (!btn) return;
  const lat = Number(btn.dataset.lat);
  const lon = Number(btn.dataset.lon);
  const dist = Number(btn.dataset.dist);
  globe.flyTo(lat, lon, dist);
});

traceSrcSelect.addEventListener('change', () => {
  if (traceSrcSelect.value === traceDstSelect.value) return;
  engine.setCustomTraceEndpoints(traceSrcSelect.value, traceDstSelect.value);
  selectedCorridorId = 'custom-trace';
  syncUI();
});

traceDstSelect.addEventListener('change', () => {
  if (traceSrcSelect.value === traceDstSelect.value) return;
  engine.setCustomTraceEndpoints(traceSrcSelect.value, traceDstSelect.value);
  selectedCorridorId = 'custom-trace';
  syncUI();
});

btnSwapTrace.addEventListener('click', () => {
  const prevSrc = traceSrcSelect.value;
  traceSrcSelect.value = traceDstSelect.value;
  traceDstSelect.value = prevSrc;
  engine.setCustomTraceEndpoints(traceSrcSelect.value, traceDstSelect.value);
  selectedCorridorId = 'custom-trace';
  syncUI();
});

oceanOpacitySlider.addEventListener('input', () => {
  const pct = Number(oceanOpacitySlider.value);
  oceanOpacityVal.textContent = pct === 0 ? 'Bathymetry Only' : `${pct}% Surface`;
  globe.setOceanOpacity(pct / 100);
});

chkPulses.addEventListener('change', () =>
  globe.setShowPulses(chkPulses.checked)
);
chkRepeaters.addEventListener('change', () =>
  globe.setShowRepeaters(chkRepeaters.checked)
);
chkHazards.addEventListener('change', () =>
  globe.setShowHazards(chkHazards.checked)
);
chkHeatmap.addEventListener('change', () =>
  globe.setShowHeatmap(chkHeatmap.checked)
);
chkTerminator.addEventListener('change', () =>
  globe.setShowTerminator(chkTerminator.checked)
);
chkOrbit.addEventListener('change', () => globe.setAutoOrbit(chkOrbit.checked));

otdrCableSelect.addEventListener('change', () => {
  inspectedCableId = otdrCableSelect.value;
  renderSeabedOtdrPanel();
  renderRepairPanel();
});

btnDiveCable.addEventListener('click', () => {
  const cable = SUBSEA_CABLES.find((c) => c.id === inspectedCableId);
  const st = currentSnapshot.cables.get(inspectedCableId);
  if (!cable || !st) return;
  const target =
    st.cutCoord ?? cable.waypoints[Math.floor(cable.waypoints.length / 2)];
  globe.diveTo(target[0], target[1]);
});

btnOtdrAction.addEventListener('click', () => {
  const st = currentSnapshot.cables.get(inspectedCableId);
  if (!st) return;
  if (st.cutState === 'active') {
    const selectedCause = faultCauseSelect.value as FaultCause | 'Auto';
    const faultMode =
      selectedCause === 'PFE Shunt Fault'
        ? 'shunt-fault'
        : selectedCause === 'Repeater Pump Failure'
        ? 'repeater-failure'
        : selectedCause === 'Shore PFE Terminal Outage'
        ? 'single-pfe-outage'
        : undefined;
    engine.severCable(
      inspectedCableId,
      undefined,
      0.5,
      selectedCause === 'Auto' ? undefined : selectedCause,
      faultMode
    );
    globe.triggerShockwave(inspectedCableId);
    telemetryAudio.playCableCut();
  } else if (st.cutState === 'severed' || st.cutState === 'degraded') {
    engine.dispatchRepairShip(inspectedCableId);
    telemetryAudio.playRerouteChirp();
  } else {
    engine.restoreCable(inspectedCableId);
    telemetryAudio.playRepairSplice();
  }
  syncUI();
});

cableSearchInput.addEventListener('input', () => renderCablesList());

const markerNodePool = new Map<string, HTMLDivElement>();

function renderProjectedMarkers(markers: ProjectedMarker[]): void {
  const seen = new Set<string>();
  for (const m of markers) {
    seen.add(m.id);
    let el = markerNodePool.get(m.id);
    if (!el) {
      el = document.createElement('div');
      markerNodePool.set(m.id, el);
      globeMarkersEl.appendChild(el);
    }
    el.className = `marker-pin ${m.kind}`;
    if (el.textContent !== m.label) el.textContent = m.label;
    el.style.transform = `translate3d(${m.x.toFixed(1)}px, ${(m.y - 22).toFixed(
      1
    )}px, 0) translateX(-50%)`;
  }
  for (const [id, el] of markerNodePool) {
    if (!seen.has(id)) {
      el.remove();
      markerNodePool.delete(id);
    }
  }
}

// Boot
initStaticControls();
setupTabs();
syncUI();
