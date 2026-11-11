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
const otdrPfeEl = document.getElementById('otdr-pfe')!;
const otdrOsnrEl = document.getElementById('otdr-osnr')!;
const otdrDepthEl = document.getElementById('otdr-depth')!;
const seabedOtdrCanvas = document.getElementById(
  'seabed-otdr-canvas'
) as HTMLCanvasElement;
const btnDiveCable = document.getElementById(
  'btn-dive-cable'
) as HTMLButtonElement;
const btnOtdrAction = document.getElementById(
  'btn-otdr-action'
) as HTMLButtonElement;

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
      announce(`${cable.name} severed. OTDR fault localized.`);
    } else if (state.cutState === 'severed') {
      engine.dispatchRepairShip(cableId);
      telemetryAudio.playRerouteChirp();
      announce(`Repair ship dispatched to ${cable.name}.`);
    } else {
      engine.restoreCable(cableId);
      telemetryAudio.playRepairSplice();
      announce(`${cable.name} optical splice completed.`);
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
    announce(`Traceroute endpoint updated to ${station.city}.`);
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
    announce(`Cable repair completed: ${completed.join(', ')}`);
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
    }
  }
});

// Populate Selectors & Scenarios
function initStaticControls(): void {
  const sortedStations = [...LANDING_STATIONS].sort((a, b) =>
    a.city.localeCompare(b.city)
  );
  for (const s of sortedStations) {
    const opt1 = document.createElement('option');
    opt1.value = s.id;
    opt1.textContent = `${s.city} (${s.country})`;
    traceSrcSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = s.id;
    opt2.textContent = `${s.city} (${s.country})`;
    traceDstSelect.appendChild(opt2);
  }
  traceSrcSelect.value = 'mombasa';
  traceDstSelect.value = 'marseille';
  engine.setCustomTraceEndpoints('mombasa', 'marseille');

  for (const c of SUBSEA_CABLES) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.systemCode} — ${c.name}`;
    otdrCableSelect.appendChild(opt);
  }
  otdrCableSelect.value = inspectedCableId;

  for (const preset of SCENARIO_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scenario-btn';
    btn.dataset.scenarioId = preset.id;
    btn.innerHTML = `
      <span class="scenario-title">${escapeHtml(preset.name)}</span>
      <span class="scenario-desc">${escapeHtml(preset.subtitle)}</span>
    `;
    btn.addEventListener('click', () => {
      activeScenarioId = preset.id;
      engine.applyScenario(preset.cableIdsToCut, preset.name, preset.cause);
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
      announce(`Scenario activated: ${preset.name}`);
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

  kpiSevered.textContent = String(s.severedCount + s.repairingCount);
  kpiSevered.className = `kpi-value ${s.severedCount > 0 ? 'danger' : ''}`;

  kpiRerouted.textContent = String(s.reroutedCount);
  kpiRerouted.className = `kpi-value ${s.reroutedCount > 0 ? 'warn' : ''}`;

  if (s.partitionedCount > 0) {
    globalStatusPill.textContent = 'PARTITIONED';
    globalStatusPill.className = 'status-pill status-critical';
  } else if (s.severedCount > 0 || s.repairingCount > 0) {
    globalStatusPill.textContent = 'REROUTE ACTIVE';
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
    traceHopsChain.textContent = 'Choose distinct source and destination hubs.';
    return;
  }

  traceStatusBadge.textContent = trace.status;
  traceStatusBadge.className = `badge badge-${trace.status.toLowerCase()}`;

  if (trace.status === 'PARTITIONED') {
    traceRttEl.textContent = 'UNREACHABLE';
    traceDeltaEl.textContent = 'LOSS';
    traceLossEl.textContent = '100% / --';
    traceHopsChain.textContent =
      'No viable optical path available. Dispatch a repair ship or restore a severed trunk.';
    return;
  }

  const delta = trace.currentRttMs - trace.baselineRttMs;
  traceRttEl.textContent = `${trace.currentRttMs.toFixed(1)} ms`;
  traceDeltaEl.textContent =
    delta > 0.1 ? `+${delta.toFixed(1)} ms` : '0.0 ms';
  traceLossEl.textContent = `${trace.packetLossPct}% / ${trace.jitterMs}ms`;

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
  traceHopsChain.textContent = segments.join(' -> ');
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
      c.status === 'PARTITIONED'
        ? '<span class="delta-bad">DOWN</span>'
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

  otdrPfeEl.textContent = cable.isTerrestrial
    ? 'TERRESTRIAL'
    : st.cutState === 'active'
    ? `±${st.pfeVoltageKv} kV`
    : '0.0 kV (TRIP)';
  otdrOsnrEl.textContent =
    st.cutState === 'active'
      ? `${st.osnrDb} dB (${st.repeaterCount} pods)`
      : `0.0 dB (LOS)`;

  if (st.cutState === 'severed') {
    otdrDepthEl.textContent = `${st.faultCause} · ${Math.abs(
      st.faultDepthM ?? 0
    )}m`;
    btnOtdrAction.textContent = 'Dispatch Repair Ship';
    btnOtdrAction.className = 'cable-action-btn repair';
  } else if (st.cutState === 'repairing') {
    otdrDepthEl.textContent = `${st.repairPhase?.toUpperCase()} · ${Math.round(
      st.repairProgress * 100
    )}%`;
    btnOtdrAction.textContent = 'Complete Splice';
    btnOtdrAction.className = 'cable-action-btn splice';
  } else {
    otdrDepthEl.textContent = `Max ${cable.depthMaxM.toLocaleString()}m`;
    btnOtdrAction.textContent = 'Sever System';
    btnOtdrAction.className = 'cable-action-btn cut';
  }

  renderSeabedAndOtdr(seabedOtdrCanvas, cable, st);

  // Sync 3D Underwater ROV & Ocean-Floor Simulation Stage
  subseaRov.updateInspection(cable, st);
  subseaCableTitle.textContent = `${cable.systemCode} — ${cable.name}`;

  const absDepthM = Math.abs(st.faultDepthM ?? cable.depthMaxM ?? 2150);
  // Hydrostatic pressure: P = rho * g * h (~0.01008 MPa per meter of seawater + 0.101 MPa atm)
  const pressureMpa = 0.101 + absDepthM * 0.01008;
  const pressureBar = Math.round(pressureMpa * 10);
  // Bottom temperature profile: warm in shallow shelf, ~1.4-2.4°C in bathypelagic/abyssal
  const bottomTempC =
    absDepthM < 250
      ? 14.2 - (absDepthM / 250) * 8.5
      : Math.max(1.3, 5.7 - ((absDepthM - 250) / 3800) * 4.2);

  subseaDepthVal.textContent = cable.isTerrestrial
    ? 'Terrestrial Trench (2.5 m)'
    : `${absDepthM.toLocaleString()} m (${
        absDepthM > 4000
          ? 'Abyssal'
          : absDepthM > 1000
          ? 'Bathypelagic'
          : 'Continental Shelf'
      })`;
  subseaPressureVal.textContent = cable.isTerrestrial
    ? '0.10 MPa (1.0 bar)'
    : `${pressureMpa.toFixed(1)} MPa (${pressureBar} bar)`;
  subseaTempVal.textContent = cable.isTerrestrial
    ? '18.5 °C · Dry Conduit'
    : `${bottomTempC.toFixed(1)} °C · 34.9 PSU`;

  const armorType =
    absDepthM < 1200
      ? 'Double-Armored Rock Wire'
      : absDepthM < 2800
      ? 'Single-Armored Galvanized'
      : 'Lightweight Deep-Sea (LW)';
  subseaArmorVal.textContent = `${armorType} · ${st.repeaterCount} EDFA Pods`;

  if (st.cutState === 'severed') {
    subseaStatusBadge.textContent = `SEVERED · ${st.faultCause?.toUpperCase()} · PFE 0kV`;
    subseaStatusBadge.className = 'badge badge-partitioned';
    btnSubseaCut.textContent = 'Deploy ROV & Repair Ship';
    btnSubseaCut.className = 'cable-action-btn repair';
  } else if (st.cutState === 'repairing') {
    subseaStatusBadge.textContent = `ROV ${st.repairPhase?.toUpperCase()} (${Math.round(
      st.repairProgress * 100
    )}%)`;
    subseaStatusBadge.className = 'badge badge-rerouted';
    btnSubseaCut.textContent = 'Complete Optical Splice';
    btnSubseaCut.className = 'cable-action-btn splice';
  } else {
    subseaStatusBadge.textContent = `INTACT · PFE ±${st.pfeVoltageKv}kV · ${st.osnrDb}dB`;
    subseaStatusBadge.className = 'badge badge-optimal';
    btnSubseaCut.textContent = 'Sever on 3D Seafloor';
    btnSubseaCut.className = 'cable-action-btn cut';
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
      c.corridorTag.toLowerCase().includes(query)
    );
  });

  filtered.sort((a, b) => {
    const sa = currentSnapshot.cables.get(a.id)?.cutState ?? 'active';
    const sb = currentSnapshot.cables.get(b.id)?.cutState ?? 'active';
    const weight = (s: string) => (s === 'severed' ? 0 : s === 'repairing' ? 1 : 2);
    return weight(sa) - weight(sb);
  });

  for (const cable of filtered) {
    const st = currentSnapshot.cables.get(cable.id)!;
    const utilPct = Math.min(100, Math.round(st.utilization * 100));
    const card = document.createElement('div');
    card.className = `cable-card ${st.cutState}`;

    const utilClass =
      st.utilization >= 0.9 ? 'over' : st.utilization >= 0.68 ? 'high' : '';

    let statusText = `${utilPct}% load (${st.carriedTbps}/${cable.capacityTbps} Tbps) · PFE ±${st.pfeVoltageKv}kV`;
    if (st.cutState === 'severed') {
      statusText = `${st.faultCause ?? 'CUT'} @ ${st.faultDistanceKm}km (${Math.abs(
        st.faultDepthM ?? cable.depthMaxM
      )}m)`;
    } else if (st.cutState === 'repairing') {
      statusText = `${st.repairShip} · ${st.repairPhase?.toUpperCase()} ${Math.round(
        st.repairProgress * 100
      )}%`;
    }

    card.innerHTML = `
      <div class="cable-card-top">
        <div>
          <div class="cable-name">${escapeHtml(cable.name)}</div>
          <div class="cable-meta">${escapeHtml(cable.systemCode)} · ${cable.lengthKm.toLocaleString()} km · ${st.repeaterCount} EDFA pods</div>
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
    inspectBtn.textContent = 'Dive';
    inspectBtn.addEventListener('click', () => {
      inspectedCableId = cable.id;
      otdrCableSelect.value = cable.id;
      const target =
        st.cutCoord ?? cable.waypoints[Math.floor(cable.waypoints.length / 2)];
      globe.diveTo(target[0], target[1]);
      renderSeabedOtdrPanel();
    });
    actionWrap.appendChild(inspectBtn);

    if (st.cutState === 'active') {
      const cutBtn = document.createElement('button');
      cutBtn.type = 'button';
      cutBtn.className = 'cable-action-btn cut';
      cutBtn.textContent = 'Sever';
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
    } else if (st.cutState === 'severed') {
      const shipBtn = document.createElement('button');
      shipBtn.type = 'button';
      shipBtn.className = 'cable-action-btn repair';
      shipBtn.textContent = 'Dispatch Ship';
      shipBtn.addEventListener('click', () => {
        engine.dispatchRepairShip(cable.id);
        telemetryAudio.playRerouteChirp();
        syncUI();
      });
      const spliceBtn = document.createElement('button');
      spliceBtn.type = 'button';
      spliceBtn.className = 'cable-action-btn splice';
      spliceBtn.textContent = 'Splice';
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
    tooltipEl.innerHTML = `
      <div class="tooltip-title">${escapeHtml(s.name)}</div>
      <div class="tooltip-sub">${escapeHtml(s.city)}, ${escapeHtml(s.country)} · Tier ${s.tier}</div>
      <div class="tooltip-meta">IXPs: ${escapeHtml(s.ixps.join(', '))}</div>
      <div class="tooltip-meta">Grid Power: ${s.powerMW} MW</div>
      <div class="tooltip-hint">Click to set traceroute ${
        nextStationTarget === 'src' ? 'source' : 'destination'
      }</div>
    `;
  } else if (info.kind === 'cable' && info.cable && info.runtime) {
    const c = info.cable;
    const r = info.runtime;
    const depthLabel =
      info.depthM && info.depthM < 0
        ? `Seabed ${Math.abs(info.depthM).toLocaleString()}m`
        : `Terrestrial`;
    const statusLine =
      r.cutState === 'severed'
        ? `SEVERED (${r.faultCause}) · OTDR ${r.faultDistanceKm} km · PFE 0 kV`
        : r.cutState === 'repairing'
        ? `${r.repairShip} · ${r.repairPhase?.toUpperCase()} (${Math.round(
            r.repairProgress * 100
          )}%)`
        : `LOAD ${Math.round(r.utilization * 100)}% (${r.carriedTbps}/${
            c.capacityTbps
          } Tbps) · PFE ±${r.pfeVoltageKv}kV · OSNR ${r.osnrDb}dB`;

    const actionHint =
      r.cutState === 'active'
        ? 'Click cable to sever at this underwater point'
        : r.cutState === 'severed'
        ? 'Click to dispatch cable repair vessel + ROV'
        : 'Click to complete optical splice';

    tooltipEl.innerHTML = `
      <div class="tooltip-title">${escapeHtml(c.name)}</div>
      <div class="tooltip-sub">${escapeHtml(c.systemCode)} · ${c.lengthKm.toLocaleString()} km · ${depthLabel}</div>
      <div class="tooltip-meta">${escapeHtml(statusLine)}</div>
      <div class="tooltip-hint">${escapeHtml(actionHint)}</div>
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
  audioLabel.textContent = next ? 'Audio On' : 'Muted';
  if (next) telemetryAudio.playHoverTick();
});

btnPauseMotion.addEventListener('click', () => {
  motionPaused = !motionPaused;
  globe.setMotionPaused(motionPaused);
  subseaRov.setMotionPaused(motionPaused);
  const labelSpan = btnPauseMotion.querySelector('span')!;
  labelSpan.textContent = motionPaused ? 'Play' : 'Pause';
});

function setViewMode(mode: 'split' | 'subsea' | 'globe'): void {
  appShell.dataset.viewMode = mode;
  viewModeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.viewMode === mode);
  });
  subseaExpandLabel.textContent =
    mode === 'subsea' ? 'Split Globe + Floor' : 'Expand 3D Floor';
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
    announce(`Restored ${restored} severed cables.`);
  }
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
  oceanOpacityVal.textContent = pct === 0 ? 'X-Ray Seabed' : `${pct}% Water`;
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
    engine.severCable(inspectedCableId);
    globe.triggerShockwave(inspectedCableId);
    telemetryAudio.playCableCut();
  } else if (st.cutState === 'severed') {
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
