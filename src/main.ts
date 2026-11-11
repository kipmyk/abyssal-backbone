import './style.css';
import { telemetryAudio } from './audio/telemetryAudio';
import {
  GLOSSARY_ENTRIES,
  INLINE_TERM_HINTS,
  MODEL_ASSUMPTIONS,
} from './data/glossary';
import {
  LANDING_STATIONS,
  SCENARIO_PRESETS,
  SUBSEA_CABLES,
} from './data/networkData';
import { getCableProvenance } from './data/provenance';
import {
  GlobeScene,
  type HoverInfo,
  type ProjectedMarker,
  type QualityModeSetting,
  type RenderQualityTier,
} from './globe/GlobeScene';
import { STATION_ASN_MAP } from './sim/bgpEngine';
import { computeSubseaRepairPlan } from './sim/repairEngine';
import { RoutingEngine } from './sim/routingEngine';
import {
  computeImpactComparison,
  hydrateEngineFromState,
  parseSimulatorHash,
  serializeSimulatorState,
} from './sim/shareState';
import {
  SubseaRovScene,
  type SubseaCameraMode,
} from './subsea/SubseaRovScene';
import type {
  EventSubsystem,
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
const kpiActivePath = document.getElementById('kpi-active-path')!;

const btnDensitySimplified = document.getElementById(
  'btn-density-simplified'
) as HTMLButtonElement;
const btnDensityEngineering = document.getElementById(
  'btn-density-engineering'
) as HTMLButtonElement;
const btnGuide = document.getElementById('btn-guide') as HTMLButtonElement;
const btnShareScenario = document.getElementById(
  'btn-share-scenario'
) as HTMLButtonElement;
const shareLabel = document.getElementById('share-label')!;
const btnContrast = document.getElementById('btn-contrast') as HTMLButtonElement;
const contrastLabel = document.getElementById('contrast-label')!;
const btnFocusMode = document.getElementById(
  'btn-focus-mode'
) as HTMLButtonElement;
const btnExitFocus = document.getElementById(
  'btn-exit-focus'
) as HTMLButtonElement;

const onboardingBanner = document.getElementById('onboarding-banner')!;
const tourStepBadge = document.getElementById('tour-step-badge')!;
const tourStepTitle = document.getElementById('tour-step-title')!;
const tourStepBody = document.getElementById('tour-step-body')!;
const btnTourAction = document.getElementById(
  'btn-tour-action'
) as HTMLButtonElement;
const btnTourNext = document.getElementById(
  'btn-tour-next'
) as HTMLButtonElement;
const btnTourGlossary = document.getElementById(
  'btn-tour-glossary'
) as HTMLButtonElement;
const btnTourDismiss = document.getElementById(
  'btn-tour-dismiss'
) as HTMLButtonElement;

const btnClickInspect = document.getElementById(
  'btn-click-inspect'
) as HTMLButtonElement;
const btnClickFault = document.getElementById(
  'btn-click-fault'
) as HTMLButtonElement;
const qualityBadge = document.getElementById('quality-badge')!;
const qualityModeSelect = document.getElementById(
  'quality-mode-select'
) as HTMLSelectElement;

const impactComparisonCard = document.getElementById('impact-comparison-card')!;
const impactBadge = document.getElementById('impact-badge')!;
const impactCapDelta = document.getElementById('impact-cap-delta')!;
const impactRttDelta = document.getElementById('impact-rtt-delta')!;
const impactPathDiff = document.getElementById('impact-path-diff')!;
const impactFlowsList = document.getElementById('impact-flows-list')!;

const historicalEventCard = document.getElementById('historical-event-card')!;
const histDate = document.getElementById('hist-date')!;
const histSummary = document.getElementById('hist-summary')!;
const histImpact = document.getElementById('hist-impact')!;
const histSource = document.getElementById('hist-source')!;

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
const btnAboutCable = document.getElementById(
  'btn-about-cable'
) as HTMLButtonElement;
const btnOtdrAction = document.getElementById(
  'btn-otdr-action'
) as HTMLButtonElement;
const inlineAssumptionsBody = document.getElementById(
  'inline-assumptions-body'
)!;

const repairTimelineCard = document.getElementById('repair-timeline-card')!;
const repairEtrPill = document.getElementById('repair-etr-pill')!;
const repairProgressFill = document.getElementById('repair-progress-fill')!;
const repairSummaryBox = document.getElementById('repair-summary-box')!;
const repairStepsList = document.getElementById('repair-steps-list')!;
const cableSearchInput = document.getElementById(
  'cable-search'
) as HTMLInputElement;
const cablesList = document.getElementById('cables-list')!;
const eventsFilterBar = document.getElementById('events-filter-bar')!;
const eventsList = document.getElementById('events-list')!;
const guideDialog = document.getElementById(
  'guide-dialog'
) as HTMLDialogElement;
const glossaryFilterInput = document.getElementById(
  'glossary-filter'
) as HTMLInputElement;
const glossaryDl = document.getElementById('glossary-dl')!;
const dialogAssumptionsList = document.getElementById(
  'dialog-assumptions-list'
)!;
const aboutCableDialog = document.getElementById(
  'about-cable-dialog'
) as HTMLDialogElement;
const aboutCableBody = document.getElementById('about-cable-body')!;
const tooltipEl = document.getElementById('globe-tooltip')!;
const announcerEl = document.getElementById('live-announcer')!;

// App State
const TOUR_STORAGE_KEY = 'abyssal-tour-dismissed-v1';
const baselineSnapshot: NetworkSnapshot = engine.computeSnapshot();
let activeScenarioId: string | null = null;
let selectedCorridorId: string = 'mba-mrs';
let inspectedCableId: string = 'aae1-redsea';
let nextStationTarget: 'src' | 'dst' = 'dst';
let motionPaused = false;
let clickMode: 'inspect' | 'fault' = 'inspect';
let densityMode: 'simplified' | 'engineering' = 'engineering';
let highContrastMode = false;
let focusMode = false;
let activeEventFilter: 'All' | EventSubsystem = 'All';
let activeQualityMode: QualityModeSetting = 'auto';
let currentSnapshot: NetworkSnapshot = baselineSnapshot;
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
  onCableClick: (cableId, cutCoord, progressT, shiftKey) => {
    const state = currentSnapshot.cables.get(cableId);
    const cable = SUBSEA_CABLES.find((c) => c.id === cableId);
    if (!state || !cable) return;

    inspectedCableId = cableId;
    otdrCableSelect.value = cableId;
    globe.setInspectedCable(cableId);

    // Clearer inspect-first workflow unless Fault/Repair mode is selected or Shift is held
    if (clickMode === 'inspect' && !shiftKey) {
      telemetryAudio.playHoverTick();
      globe.diveTo(cutCoord[0], cutCoord[1]);
      syncUI();
      announce(
        `Inspecting ${cable.name} (${cable.systemCode}). Switch to Fault / Repair mode or hold Shift + click to inject a fault.`
      );
      return;
    }

    activeScenarioId = null;

    if (state.cutState === 'active') {
      engine.severCable(cableId, cutCoord, progressT);
      globe.triggerShockwave(cableId);
      telemetryAudio.playCableCut();
      setTimeout(() => telemetryAudio.playRerouteChirp(), 240);
      announce(`Cable fault injected on ${cable.name}.`);
    } else if (state.cutState === 'severed' || state.cutState === 'degraded') {
      engine.dispatchRepairShip(cableId);
      telemetryAudio.playRerouteChirp();
      globe.flyTo(cutCoord[0], cutCoord[1], 19);
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

  onQualityChange: (tier: RenderQualityTier) => {
    subseaRov.setQualityTier(tier);
    const labelMap: Record<RenderQualityTier, string> = {
      high: 'High',
      balanced: 'Balanced',
      eco: 'Eco',
    };
    const modePrefix = activeQualityMode === 'auto' ? 'Auto' : 'Manual';
    qualityBadge.textContent = `Quality: ${modePrefix} (${labelMap[tier]})`;
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
  globe.setInspectedCable(inspectedCableId);
  globe.updateSnapshot(
    currentSnapshot,
    highlighted?.currentCables ?? [],
    highlighted ? [highlighted.srcId, highlighted.dstId] : []
  );

  renderHeaderKPIs();
  renderScenarioButtons();
  renderHistoricalContext();
  renderImpactComparison();
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

  const activeTrace = getHighlightedTrace();
  if (activeTrace && activeTrace.currentCables.length > 0) {
    const codes = activeTrace.currentCables.map(
      (id) => SUBSEA_CABLES.find((c) => c.id === id)?.systemCode ?? id
    );
    kpiActivePath.textContent = `${codes.join(' -> ')} (${activeTrace.currentRttMs.toFixed(1)} ms)`;
  } else if (activeTrace) {
    kpiActivePath.textContent = `${activeTrace.status}`;
  } else {
    kpiActivePath.textContent = '--';
  }

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

function renderImpactComparison(): void {
  const report = computeImpactComparison(baselineSnapshot, currentSnapshot);
  if (!report.hasChanges) {
    impactComparisonCard.hidden = true;
    return;
  }

  impactComparisonCard.hidden = false;
  impactBadge.textContent =
    report.impactedCorridors.length > 0
      ? `${report.impactedCorridors.length} FLOW${report.impactedCorridors.length > 1 ? 'S' : ''} SHIFTED`
      : 'TRUNK FAULT';
  impactBadge.className = `badge ${
    report.impactedCorridors.length > 0 ? 'badge-rerouted' : 'badge-partitioned'
  }`;

  const capSign = report.capacityDeltaTbps > 0 ? '+' : '';
  impactCapDelta.textContent = `${capSign}${report.capacityDeltaTbps} Tbps (${report.capacityDeltaPct}%)`;
  impactCapDelta.className = `mono-val ${
    report.capacityDeltaTbps < 0 ? 'delta-bad' : ''
  }`;

  const rttSign = report.meanRttDeltaMs > 0 ? '+' : '';
  impactRttDelta.textContent = `${rttSign}${report.meanRttDeltaMs} ms`;
  impactRttDelta.className = `mono-val ${
    report.meanRttDeltaMs > 15 ? 'delta-bad' : report.meanRttDeltaMs > 1 ? 'delta-up' : ''
  }`;

  const trace = getHighlightedTrace();
  if (trace && trace.bgpRoute) {
    const baseCorridor = baselineSnapshot.corridors.find(
      (c) => c.id === trace.id
    );
    const prevAs =
      baseCorridor?.bgpRoute?.asPath.map((a) => `AS${a}`).join(' ') ??
      'Direct Baseline';
    const nextAs = trace.bgpRoute.asPath.map((a) => `AS${a}`).join(' ');
    impactPathDiff.textContent =
      prevAs === nextAs
        ? `Inspected AS_PATH unchanged: [${nextAs}]`
        : `Inspected AS_PATH: [${prevAs}] -> [${nextAs}]`;
  } else if (trace) {
    impactPathDiff.textContent = `Inspected Corridor: ${trace.status} (Route withdrawn or filtered)`;
  } else {
    impactPathDiff.textContent = '';
  }

  impactFlowsList.innerHTML = '';
  for (const flow of report.impactedCorridors.slice(0, 6)) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-ghost';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    const rttDiffStr =
      flow.status === 'PARTITIONED' || flow.status === 'POLICY_BLOCKED'
        ? flow.status
        : `+${flow.rttDeltaMs} ms`;
    const cablesDiff =
      flow.afterCables.length > 0 ? flow.afterCables.join('->') : 'NONE';
    btn.textContent = `${flow.label}: ${rttDiffStr} via [${cablesDiff}]`;
    btn.addEventListener('click', () => {
      const target = currentSnapshot.corridors.find((c) => c.id === flow.id);
      if (!target) return;
      selectedCorridorId = target.id;
      traceSrcSelect.value = target.srcId;
      traceDstSelect.value = target.dstId;
      engine.setCustomTraceEndpoints(target.srcId, target.dstId);
      const srcSt = stationById.get(target.srcId);
      const dstSt = stationById.get(target.dstId);
      if (srcSt && dstSt) {
        globe.flyTo((srcSt.lat + dstSt.lat) / 2, (srcSt.lon + dstSt.lon) / 2, 24);
      }
      syncUI();
    });
    li.appendChild(btn);
    impactFlowsList.appendChild(li);
  }
}

function renderHistoricalContext(): void {
  if (!activeScenarioId) {
    historicalEventCard.hidden = true;
    return;
  }
  const preset = SCENARIO_PRESETS.find((p) => p.id === activeScenarioId);
  const hist = preset?.historicalEvent;
  if (!hist) {
    historicalEventCard.hidden = true;
    return;
  }

  historicalEventCard.hidden = false;
  histDate.textContent = hist.date;
  histSummary.textContent = hist.factualSummary;
  histImpact.textContent = `Observed impact: ${hist.impactHighlight}`;
  histSource.textContent = `Reference: ${hist.sourceNote}`;
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

  repairTimelineCard.hidden = false;
  const pct =
    st.cutState === 'repairing'
      ? Math.max(4, Math.min(100, Math.round(st.repairProgress * 100)))
      : 0;
  repairProgressFill.style.inlineSize = `${pct}%`;
  repairEtrPill.textContent =
    st.cutState === 'repairing'
      ? `ETR ${plan.remainingHours}h (${pct}%)`
      : st.cutState === 'severed' || st.cutState === 'degraded'
      ? `Est. ${plan.totalEstimatedHours}h`
      : 'Standby';

  const currentIdx = st.cutState === 'repairing' ? plan.currentStepIndex : -1;
  const phaseRanges: Array<{ phase: string; min: number; max: number }> = [
    { phase: 'steaming', min: 0, max: 3 },
    { phase: 'grappling', min: 4, max: 7 },
    { phase: 'splicing', min: 8, max: 11 },
    { phase: 'pfe-ramp', min: 12, max: 14 },
  ];
  repairTimelineCard
    .querySelectorAll<HTMLElement>('.repair-phases-row span[data-phase]')
    .forEach((el) => {
      const range = phaseRanges.find((p) => p.phase === el.dataset.phase);
      if (!range) return;
      el.classList.toggle(
        'is-done',
        currentIdx > range.max && st.cutState === 'repairing'
      );
      el.classList.toggle(
        'is-active',
        st.cutState === 'repairing' &&
          currentIdx >= range.min &&
          currentIdx <= range.max
      );
    });

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
        inspectedCableId = cable.id;
        otdrCableSelect.value = cable.id;
        engine.dispatchRepairShip(cable.id);
        telemetryAudio.playRerouteChirp();
        const stNow = currentSnapshot.cables.get(cable.id);
        const focusCoord =
          stNow?.cutCoord ??
          cable.waypoints[Math.floor(cable.waypoints.length / 2)];
        globe.flyTo(focusCoord[0], focusCoord[1], 19.5);
        announce(`Repair vessel mobilized for ${cable.name}.`);
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
  const allEvents = engine.getEvents();
  const filtered =
    activeEventFilter === 'All'
      ? allEvents
      : allEvents.filter((evt) => evt.subsystem === activeEventFilter);

  if (filtered.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'event-item info';
    emptyLi.textContent = `No ${activeEventFilter} telemetry events recorded yet.`;
    eventsList.appendChild(emptyLi);
    return;
  }

  for (const evt of filtered) {
    const li = document.createElement('li');
    li.className = `event-item ${evt.severity}`;
    li.innerHTML = `
      <div class="event-head">
        <span class="event-code">${escapeHtml(evt.code)}</span>
        <span class="event-meta-row">
          <span class="event-subsystem-badge">${escapeHtml(evt.subsystem)}</span>
          <span class="event-rel-time">${escapeHtml(evt.relativeTime)}</span>
          <span>${escapeHtml(evt.timestamp)}</span>
        </span>
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

    tab.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      container: 'nearest',
    } as ScrollIntoViewOptions);

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
  globe.setInspectedCable(inspectedCableId);
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
    const cableObj = SUBSEA_CABLES.find((c) => c.id === inspectedCableId);
    const focusCoord =
      st.cutCoord ??
      cableObj?.waypoints[Math.floor((cableObj?.waypoints.length ?? 2) / 2)];
    if (focusCoord) {
      globe.flyTo(focusCoord[0], focusCoord[1], 19.5);
    }
    const repairTab = document.getElementById('tab-repair') as HTMLButtonElement | null;
    repairTab?.click();
    announce(`Repair vessel mobilized for ${cableObj?.name ?? inspectedCableId}.`);
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

// Keep 2D C-OTDR & Bathymetric cross-section canvas sharp across viewport & orientation changes
if (seabedOtdrCanvas.parentElement && typeof ResizeObserver !== 'undefined') {
  const otdrResizeObserver = new ResizeObserver(() => {
    const cable = SUBSEA_CABLES.find((c) => c.id === inspectedCableId);
    const st = currentSnapshot.cables.get(inspectedCableId);
    if (cable && st && seabedOtdrCanvas.clientWidth > 0) {
      renderSeabedAndOtdr(seabedOtdrCanvas, cable, st);
    }
  });
  otdrResizeObserver.observe(seabedOtdrCanvas.parentElement);
}

function populateTermHints(): void {
  const hintMap: Record<string, string> = {
    'hint-bgp': 'bgp',
    'hint-cls': 'cls',
    'hint-gsnr': 'gsnr',
    'hint-qfactor': 'qfactor',
    'hint-pfe': 'pfe',
  };
  for (const [elId, hintKey] of Object.entries(hintMap)) {
    const el = document.getElementById(elId);
    const data = INLINE_TERM_HINTS[hintKey];
    if (!el || !data) continue;
    el.innerHTML = `<h4>${escapeHtml(data.title)}</h4><p>${escapeHtml(data.body)}</p>`;
  }
}

function renderGlossary(filterQuery = ''): void {
  const q = filterQuery.trim().toLowerCase();
  glossaryDl.innerHTML = '';
  const filtered = GLOSSARY_ENTRIES.filter((entry) => {
    if (!q) return true;
    return (
      entry.term.toLowerCase().includes(q) ||
      entry.shortLabel.toLowerCase().includes(q) ||
      entry.category.toLowerCase().includes(q) ||
      entry.definition.toLowerCase().includes(q)
    );
  });

  if (filtered.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'glossary-item';
    emptyDiv.textContent = 'No matching glossary entries found.';
    glossaryDl.appendChild(emptyDiv);
    return;
  }

  for (const entry of filtered) {
    const wrapper = document.createElement('div');
    wrapper.className = 'glossary-item';
    wrapper.innerHTML = `
      <dt>${escapeHtml(entry.shortLabel)} <span class="glossary-cat">${escapeHtml(entry.category)}</span></dt>
      <dd>${escapeHtml(entry.definition)}</dd>
    `;
    glossaryDl.appendChild(wrapper);
  }
}

function renderAssumptions(): void {
  const buildMarkup = () =>
    MODEL_ASSUMPTIONS.map(
      (group) => `
      <div class="assumption-group">
        <h4>${escapeHtml(group.title)}</h4>
        <ul>${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>`
    ).join('');

  dialogAssumptionsList.innerHTML = buildMarkup();
  inlineAssumptionsBody.innerHTML = buildMarkup();
}

function openAboutCableDialog(cableId: string): void {
  const cable = SUBSEA_CABLES.find((c) => c.id === cableId);
  if (!cable) return;
  const prov = getCableProvenance(cable);
  const st = currentSnapshot.cables.get(cable.id);
  const endpoints = `${stationById.get(cable.endpoints[0])?.city ?? cable.endpoints[0]} <-> ${stationById.get(cable.endpoints[1])?.city ?? cable.endpoints[1]}`;

  aboutCableBody.innerHTML = `
    <div class="about-spec-grid">
      <div class="about-spec-cell">
        <span class="about-spec-label">System Name / Code</span>
        <span class="about-spec-value">${escapeHtml(cable.name)} (${escapeHtml(cable.systemCode)})</span>
      </div>
      <div class="about-spec-cell">
        <span class="about-spec-label">Route Endpoints</span>
        <span class="about-spec-value">${escapeHtml(endpoints)}</span>
      </div>
      <div class="about-spec-cell">
        <span class="about-spec-label">Route Length</span>
        <span class="about-spec-value">${cable.lengthKm.toLocaleString()} km (${cable.waypoints.length} plotted vertices)</span>
      </div>
      <div class="about-spec-cell">
        <span class="about-spec-label">Ready for Service (RFS)</span>
        <span class="about-spec-value">${cable.rfsYear}</span>
      </div>
      <div class="about-spec-cell">
        <span class="about-spec-label">Design Capacity / Pairs</span>
        <span class="about-spec-value">${cable.capacityTbps} Tbps · ${prov.fiberPairs} Fiber Pairs</span>
      </div>
      <div class="about-spec-cell">
        <span class="about-spec-label">Branching &amp; Zone</span>
        <span class="about-spec-value">${prov.branchingUnits.length} BU · ${escapeHtml(prov.maintenanceZone)}</span>
      </div>
    </div>
    <div class="assumption-group">
      <h4>Owners / Consortium &amp; Provenance</h4>
      <ul>
        <li><strong>Owners:</strong> ${escapeHtml(cable.owners)}</li>
        <li><strong>Corridor / Fiber Spec:</strong> ${escapeHtml(cable.corridorTag)} · ${escapeHtml(st?.optical.fiberStandard ?? 'ITU-T G.654.E / G.652.D')} (Route: ${escapeHtml(prov.routeConfidence)}, Cap: ${escapeHtml(prov.capacityConfidence)})</li>
        <li><strong>Citation:</strong> ${escapeHtml(prov.sourceCitation)} (${escapeHtml(prov.sourceDate)})</li>
        <li><strong>Branching Units:</strong> ${prov.branchingUnits.length > 0 ? escapeHtml(prov.branchingUnits.map((b) => `${b.name} (${b.opticalRouting})`).join(', ')) : 'Point-to-point trunk (no subsea BU)'}</li>
      </ul>
    </div>
    <p class="disclaimer-callout">
      Educational system summary derived from public ITU/TeleGeography/operator disclosures. Synthetic telemetry parameters are approximations.
    </p>
  `;

  if (typeof aboutCableDialog.showModal === 'function') {
    aboutCableDialog.showModal();
  }
}

function setDensityMode(mode: 'simplified' | 'engineering'): void {
  densityMode = mode;
  appShell.dataset.density = mode;
  btnDensitySimplified.classList.toggle('active', mode === 'simplified');
  btnDensityEngineering.classList.toggle('active', mode === 'engineering');
  btnDensitySimplified.setAttribute(
    'aria-pressed',
    String(mode === 'simplified')
  );
  btnDensityEngineering.setAttribute(
    'aria-pressed',
    String(mode === 'engineering')
  );
  announce(`Telemetry density set to ${mode} mode.`);
}

function setContrastTheme(enabled: boolean): void {
  highContrastMode = enabled;
  if (enabled) {
    appShell.dataset.theme = 'high-contrast';
  } else {
    delete appShell.dataset.theme;
  }
  btnContrast.setAttribute('aria-pressed', String(enabled));
  contrastLabel.textContent = enabled ? 'Standard Theme' : 'High Contrast';
  announce(enabled ? 'High-contrast theme enabled.' : 'Standard theme restored.');
}

function setFocusMode(enabled: boolean): void {
  focusMode = enabled;
  appShell.classList.toggle('focus-mode', enabled);
  btnFocusMode.setAttribute('aria-pressed', String(enabled));
  btnExitFocus.hidden = !enabled;
  window.dispatchEvent(new Event('resize'));
  announce(
    enabled
      ? 'Focus mode enabled: side panels hidden. Press F or click Exit Focus Mode to restore.'
      : 'Focus mode exited: panels restored.'
  );
}

function setClickMode(mode: 'inspect' | 'fault'): void {
  clickMode = mode;
  btnClickInspect.classList.toggle('active', mode === 'inspect');
  btnClickFault.classList.toggle('active', mode === 'fault');
  btnClickInspect.setAttribute('aria-pressed', String(mode === 'inspect'));
  btnClickFault.setAttribute('aria-pressed', String(mode === 'fault'));
  announce(`Globe cable click mode set to ${mode}.`);
}

function setupDialogBackdropFallbacks(): void {
  const dialogs = [guideDialog, aboutCableDialog];
  for (const dlg of dialogs) {
    if ('closedBy' in HTMLDialogElement.prototype) continue;
    let pointerStartedOutside = false;
    dlg.addEventListener('pointerdown', (e) => {
      if (e.target !== dlg) {
        pointerStartedOutside = false;
        return;
      }
      const rect = dlg.getBoundingClientRect();
      pointerStartedOutside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;
    });
    dlg.addEventListener('pointerup', (e) => {
      if (!pointerStartedOutside || e.target !== dlg) return;
      const rect = dlg.getBoundingClientRect();
      const outside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;
      if (outside) dlg.close();
      pointerStartedOutside = false;
    });
  }
}

function setupToggletipSync(): void {
  document.addEventListener(
    'toggle',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.id) return;
      const invoker = document.querySelector<HTMLButtonElement>(
        `[popovertarget="${target.id}"]`
      );
      if (!invoker) return;
      invoker.setAttribute(
        'aria-expanded',
        String((e as ToggleEvent).newState === 'open')
      );
    },
    true
  );
}

function setupOnboardingTour(): void {
  const TOUR_STEPS = [
    {
      title: 'Explore the Three 3D Viewports',
      body: 'Switch between Split (Globe + Seabed ROV), 3D Seafloor cutaway, and Hydrographic Globe in the top bar. Press F anytime for Focus Mode.',
      actionLabel: 'Preview Globe View',
      runAction: () => setViewMode(appShell.dataset.viewMode === 'globe' ? 'split' : 'globe'),
    },
    {
      title: 'Inspect BGP-4 Paths & Detours',
      body: 'Click two Cable Landing Stations on the globe (or pick Origin/Destination in the left dock) to inspect live AS_PATH, LOCAL_PREF, MED, and policy filters.',
      actionLabel: 'Trace Mombasa -> Marseille',
      runAction: () => {
        traceSrcSelect.value = 'mombasa';
        traceDstSelect.value = 'marseille';
        engine.setCustomTraceEndpoints('mombasa', 'marseille');
        selectedCorridorId = 'mba-mrs';
        syncUI();
      },
    },
    {
      title: 'Simulate Real-World Cuts & Compare Impact',
      body: 'Trigger the 2024 Red Sea Multi-Cable Cut or use Fault / Repair click mode on any trunk, then review Before/After capacity, RTT, and BGP diff deltas.',
      actionLabel: 'Simulate Red Sea Cut',
      runAction: () => {
        const redSeaBtn = scenarioList.querySelector<HTMLButtonElement>(
          '[data-scenario-id="red-sea-blackout"]'
        );
        redSeaBtn?.click();
      },
    },
    {
      title: 'Switch Density or Open Engineering Glossary',
      body: 'Toggle Simplified mode for essential KPIs & active path, or Engineering mode for full ITU-T G.977 optical budgets, PFE voltages, and C-OTDR traces.',
      actionLabel: 'Toggle Simplified / Eng',
      runAction: () =>
        setDensityMode(
          densityMode === 'engineering' ? 'simplified' : 'engineering'
        ),
    },
  ];

  let stepIdx = 0;

  const renderStep = () => {
    const step = TOUR_STEPS[stepIdx];
    tourStepBadge.textContent = `TOUR · ${stepIdx + 1} / ${TOUR_STEPS.length}`;
    tourStepTitle.textContent = step.title;
    tourStepBody.textContent = step.body;
    btnTourAction.textContent = step.actionLabel;
    btnTourNext.textContent =
      stepIdx === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
  };

  btnTourAction.addEventListener('click', () => {
    TOUR_STEPS[stepIdx].runAction();
  });

  btnTourNext.addEventListener('click', () => {
    if (stepIdx < TOUR_STEPS.length - 1) {
      stepIdx += 1;
      renderStep();
    } else {
      onboardingBanner.hidden = true;
      try {
        localStorage.setItem(TOUR_STORAGE_KEY, '1');
      } catch {
        /* ignore storage restrictions */
      }
    }
  });

  btnTourGlossary.addEventListener('click', () => {
    renderGlossary(glossaryFilterInput.value);
    if (typeof guideDialog.showModal === 'function') {
      guideDialog.showModal();
    }
  });

  btnTourDismiss.addEventListener('click', () => {
    onboardingBanner.hidden = true;
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      /* ignore storage restrictions */
    }
  });

  const startTourBtn = document.getElementById('btn-start-tour');
  startTourBtn?.addEventListener('click', () => {
    stepIdx = 0;
    renderStep();
    if (guideDialog.open) guideDialog.close();
    onboardingBanner.hidden = false;
    announce('Interactive quick-start tour opened.');
  });

  // Keep viewport unobstructed by default; tour launches on demand from Guide dialog
  onboardingBanner.hidden = true;
}

btnDensitySimplified.addEventListener('click', () =>
  setDensityMode('simplified')
);
btnDensityEngineering.addEventListener('click', () =>
  setDensityMode('engineering')
);

btnGuide.addEventListener('click', () => {
  renderGlossary(glossaryFilterInput.value);
  if (typeof guideDialog.showModal === 'function') {
    guideDialog.showModal();
  }
});

glossaryFilterInput.addEventListener('input', () => {
  renderGlossary(glossaryFilterInput.value);
});

btnAboutCable.addEventListener('click', () => {
  openAboutCableDialog(inspectedCableId);
});

btnContrast.addEventListener('click', () => {
  setContrastTheme(!highContrastMode);
});

btnFocusMode.addEventListener('click', () => {
  setFocusMode(!focusMode);
});

btnExitFocus.addEventListener('click', () => {
  setFocusMode(false);
});

btnClickInspect.addEventListener('click', () => setClickMode('inspect'));
btnClickFault.addEventListener('click', () => setClickMode('fault'));

qualityModeSelect.addEventListener('change', () => {
  const mode = (qualityModeSelect.value as QualityModeSetting) ?? 'auto';
  activeQualityMode = mode;
  globe.setQualityMode(mode);
  if (mode === 'high' || mode === 'eco') {
    subseaRov.setQualityTier(mode);
  }
  announce(`Render quality set to ${mode}.`);
});

eventsFilterBar.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
    'button[data-evt-filter]'
  );
  if (!btn) return;
  activeEventFilter = (btn.dataset.evtFilter as 'All' | EventSubsystem) ?? 'All';
  eventsFilterBar
    .querySelectorAll<HTMLButtonElement>('button[data-evt-filter]')
    .forEach((b) => {
      const isSelected = b === btn;
      b.classList.toggle('active', isSelected);
      b.setAttribute('aria-pressed', String(isSelected));
    });
  renderEventsLog();
});

btnShareScenario.addEventListener('click', async () => {
  const hash = serializeSimulatorState({
    snapshot: currentSnapshot,
    activeScenarioId,
    srcId: traceSrcSelect.value,
    dstId: traceDstSelect.value,
    inspectedCableId,
    viewMode:
      (appShell.dataset.viewMode as 'split' | 'subsea' | 'globe') ?? 'split',
    density: densityMode,
    highContrast: highContrastMode,
  });
  history.replaceState(null, '', hash);
  const fullUrl = window.location.href;
  try {
    await navigator.clipboard.writeText(fullUrl);
    shareLabel.textContent = 'Copied Link';
  } catch {
    shareLabel.textContent = 'URL Updated';
  }
  announce('Shareable scenario state encoded in browser URL.');
  setTimeout(() => {
    shareLabel.textContent = 'Share';
  }, 2200);
});

window.addEventListener('keydown', (e) => {
  if (
    e.key.toLowerCase() === 'f' &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !(
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement
    ) &&
    !guideDialog.open &&
    !aboutCableDialog.open
  ) {
    e.preventDefault();
    setFocusMode(!focusMode);
  }
});

// Boot
initStaticControls();
setupTabs();
populateTermHints();
renderGlossary();
renderAssumptions();
setupDialogBackdropFallbacks();
setupToggletipSync();
setupOnboardingTour();
chkOrbit.checked = true;
globe.setAutoOrbit(true);

const initialHashState = parseSimulatorHash(location.hash);
if (initialHashState) {
  activeScenarioId = initialHashState.sc ?? null;
  hydrateEngineFromState(engine, initialHashState);
  if (initialHashState.src && initialHashState.dst) {
    traceSrcSelect.value = initialHashState.src;
    traceDstSelect.value = initialHashState.dst;
    engine.setCustomTraceEndpoints(initialHashState.src, initialHashState.dst);
  }
  if (initialHashState.ins) {
    inspectedCableId = initialHashState.ins;
    otdrCableSelect.value = initialHashState.ins;
  }
  if (initialHashState.vm) setViewMode(initialHashState.vm);
  if (initialHashState.dn) setDensityMode(initialHashState.dn);
  setContrastTheme(Boolean(initialHashState.hc));
}

syncUI();
