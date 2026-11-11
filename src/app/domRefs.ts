import type { ProjectedMarker } from '../globe/GlobeScene';

export interface DomRefs {
  appShell: HTMLElement;
  globeContainer: HTMLElement;
  globeMarkersEl: HTMLElement;
  subseaRovContainer: HTMLElement;
  subseaCableTitle: HTMLElement;
  subseaStatusBadge: HTMLElement;
  subseaDepthVal: HTMLElement;
  subseaPressureVal: HTMLElement;
  subseaTempVal: HTMLElement;
  subseaArmorVal: HTMLElement;
  btnSubseaCut: HTMLButtonElement;
  btnSubseaExpand: HTMLButtonElement;
  subseaExpandLabel: HTMLElement;
  viewModeButtons: HTMLButtonElement[];
  subseaCamButtons: HTMLButtonElement[];

  globalStatusPill: HTMLElement;
  kpiCapacity: HTMLElement;
  kpiRtt: HTMLElement;
  kpiSevered: HTMLElement;
  kpiRerouted: HTMLElement;
  kpiActivePath: HTMLElement;

  btnDensitySimplified: HTMLButtonElement;
  btnDensityEngineering: HTMLButtonElement;
  btnGuide: HTMLButtonElement;
  btnShareScenario: HTMLButtonElement;
  shareLabel: HTMLElement;
  btnContrast: HTMLButtonElement;
  contrastLabel: HTMLElement;
  btnFocusMode: HTMLButtonElement;
  btnExitFocus: HTMLButtonElement;

  onboardingBanner: HTMLElement;
  tourStepBadge: HTMLElement;
  tourStepTitle: HTMLElement;
  tourStepBody: HTMLElement;
  btnTourAction: HTMLButtonElement;
  btnTourNext: HTMLButtonElement;
  btnTourGlossary: HTMLButtonElement;
  btnTourDismiss: HTMLButtonElement;
  btnStartTour: HTMLButtonElement | null;

  btnClickInspect: HTMLButtonElement;
  btnClickFault: HTMLButtonElement;
  qualityBadge: HTMLElement;
  qualityModeSelect: HTMLSelectElement;

  impactComparisonCard: HTMLElement;
  impactBadge: HTMLElement;
  impactCapDelta: HTMLElement;
  impactRttDelta: HTMLElement;
  impactPathDiff: HTMLElement;
  impactFlowsList: HTMLElement;

  historicalEventCard: HTMLElement;
  histDate: HTMLElement;
  histSummary: HTMLElement;
  histImpact: HTMLElement;
  histSource: HTMLElement;

  btnAudio: HTMLButtonElement;
  audioLabel: HTMLElement;
  btnPauseMotion: HTMLButtonElement;
  btnHudToggle: HTMLButtonElement;
  btnRestoreAll: HTMLButtonElement;

  faultCauseSelect: HTMLSelectElement;
  scenarioList: HTMLElement;
  cameraPresets: HTMLElement;

  traceSrcSelect: HTMLSelectElement;
  traceDstSelect: HTMLSelectElement;
  btnSwapTrace: HTMLButtonElement;
  traceStatusBadge: HTMLElement;
  traceRttEl: HTMLElement;
  traceDeltaEl: HTMLElement;
  traceLossEl: HTMLElement;
  bgpRibBox: HTMLElement;
  traceHopsChain: HTMLElement;

  oceanOpacitySlider: HTMLInputElement;
  oceanOpacityVal: HTMLElement;
  chkPulses: HTMLInputElement;
  chkRepeaters: HTMLInputElement;
  chkHazards: HTMLInputElement;
  chkHeatmap: HTMLInputElement;
  chkTerminator: HTMLInputElement;
  chkOrbit: HTMLInputElement;

  corridorsTbody: HTMLElement;
  otdrCableSelect: HTMLSelectElement;
  otdrProvenanceBadge: HTMLElement;
  optFiberVal: HTMLElement;
  optSpanVal: HTMLElement;
  otdrOsnrEl: HTMLElement;
  optQVal: HTMLElement;
  optBerVal: HTMLElement;
  optDispVal: HTMLElement;
  otdrPfeEl: HTMLElement;
  pfeCurrentVal: HTMLElement;
  otdrDepthEl: HTMLElement;
  otdrNotesBox: HTMLElement;
  seabedOtdrCanvas: HTMLCanvasElement;
  btnDiveCable: HTMLButtonElement;
  btnAboutCable: HTMLButtonElement;
  btnOtdrAction: HTMLButtonElement;
  inlineAssumptionsBody: HTMLElement;

  repairTimelineCard: HTMLElement;
  repairEtrPill: HTMLElement;
  repairProgressFill: HTMLElement;
  repairSummaryBox: HTMLElement;
  repairStepsList: HTMLElement;
  cableSearchInput: HTMLInputElement;
  cablesList: HTMLElement;
  eventsFilterBar: HTMLElement;
  eventsList: HTMLElement;

  guideDialog: HTMLDialogElement;
  glossaryFilterInput: HTMLInputElement;
  glossaryDl: HTMLElement;
  dialogAssumptionsList: HTMLElement;
  aboutCableDialog: HTMLDialogElement;
  aboutCableBody: HTMLElement;

  tooltipEl: HTMLElement;
  announcerEl: HTMLElement;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Expected DOM element #${id} to exist in index.html`);
  }
  return el as T;
}

export function getDomRefs(): DomRefs {
  return {
    appShell: byId('app'),
    globeContainer: byId('globe-viewport'),
    globeMarkersEl: byId('globe-markers'),
    subseaRovContainer: byId('subsea-rov-viewport'),
    subseaCableTitle: byId('subsea-cable-title'),
    subseaStatusBadge: byId('subsea-status-badge'),
    subseaDepthVal: byId('subsea-depth-val'),
    subseaPressureVal: byId('subsea-pressure-val'),
    subseaTempVal: byId('subsea-temp-val'),
    subseaArmorVal: byId('subsea-armor-val'),
    btnSubseaCut: byId<HTMLButtonElement>('btn-subsea-cut'),
    btnSubseaExpand: byId<HTMLButtonElement>('btn-subsea-expand'),
    subseaExpandLabel: byId('subsea-expand-label'),
    viewModeButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>('.view-mode-btn[data-view-mode]')
    ),
    subseaCamButtons: Array.from(
      document.querySelectorAll<HTMLButtonElement>('.subsea-cam-btn')
    ),

    globalStatusPill: byId('global-status-pill'),
    kpiCapacity: byId('kpi-capacity'),
    kpiRtt: byId('kpi-rtt'),
    kpiSevered: byId('kpi-severed'),
    kpiRerouted: byId('kpi-rerouted'),
    kpiActivePath: byId('kpi-active-path'),

    btnDensitySimplified: byId<HTMLButtonElement>('btn-density-simplified'),
    btnDensityEngineering: byId<HTMLButtonElement>('btn-density-engineering'),
    btnGuide: byId<HTMLButtonElement>('btn-guide'),
    btnShareScenario: byId<HTMLButtonElement>('btn-share-scenario'),
    shareLabel: byId('share-label'),
    btnContrast: byId<HTMLButtonElement>('btn-contrast'),
    contrastLabel: byId('contrast-label'),
    btnFocusMode: byId<HTMLButtonElement>('btn-focus-mode'),
    btnExitFocus: byId<HTMLButtonElement>('btn-exit-focus'),

    onboardingBanner: byId('onboarding-banner'),
    tourStepBadge: byId('tour-step-badge'),
    tourStepTitle: byId('tour-step-title'),
    tourStepBody: byId('tour-step-body'),
    btnTourAction: byId<HTMLButtonElement>('btn-tour-action'),
    btnTourNext: byId<HTMLButtonElement>('btn-tour-next'),
    btnTourGlossary: byId<HTMLButtonElement>('btn-tour-glossary'),
    btnTourDismiss: byId<HTMLButtonElement>('btn-tour-dismiss'),
    btnStartTour: document.getElementById(
      'btn-start-tour'
    ) as HTMLButtonElement | null,

    btnClickInspect: byId<HTMLButtonElement>('btn-click-inspect'),
    btnClickFault: byId<HTMLButtonElement>('btn-click-fault'),
    qualityBadge: byId('quality-badge'),
    qualityModeSelect: byId<HTMLSelectElement>('quality-mode-select'),

    impactComparisonCard: byId('impact-comparison-card'),
    impactBadge: byId('impact-badge'),
    impactCapDelta: byId('impact-cap-delta'),
    impactRttDelta: byId('impact-rtt-delta'),
    impactPathDiff: byId('impact-path-diff'),
    impactFlowsList: byId('impact-flows-list'),

    historicalEventCard: byId('historical-event-card'),
    histDate: byId('hist-date'),
    histSummary: byId('hist-summary'),
    histImpact: byId('hist-impact'),
    histSource: byId('hist-source'),

    btnAudio: byId<HTMLButtonElement>('btn-audio'),
    audioLabel: byId('audio-label'),
    btnPauseMotion: byId<HTMLButtonElement>('btn-pause-motion'),
    btnHudToggle: byId<HTMLButtonElement>('btn-hud-toggle'),
    btnRestoreAll: byId<HTMLButtonElement>('btn-restore-all'),

    faultCauseSelect: byId<HTMLSelectElement>('fault-cause-select'),
    scenarioList: byId('scenario-list'),
    cameraPresets: byId('camera-presets'),

    traceSrcSelect: byId<HTMLSelectElement>('trace-src'),
    traceDstSelect: byId<HTMLSelectElement>('trace-dst'),
    btnSwapTrace: byId<HTMLButtonElement>('btn-swap-trace'),
    traceStatusBadge: byId('trace-status-badge'),
    traceRttEl: byId('trace-rtt'),
    traceDeltaEl: byId('trace-delta'),
    traceLossEl: byId('trace-loss'),
    bgpRibBox: byId('bgp-rib-box'),
    traceHopsChain: byId('trace-hops-chain'),

    oceanOpacitySlider: byId<HTMLInputElement>('ocean-opacity-slider'),
    oceanOpacityVal: byId('ocean-opacity-val'),
    chkPulses: byId<HTMLInputElement>('chk-pulses'),
    chkRepeaters: byId<HTMLInputElement>('chk-repeaters'),
    chkHazards: byId<HTMLInputElement>('chk-hazards'),
    chkHeatmap: byId<HTMLInputElement>('chk-heatmap'),
    chkTerminator: byId<HTMLInputElement>('chk-terminator'),
    chkOrbit: byId<HTMLInputElement>('chk-orbit'),

    corridorsTbody: byId('corridors-tbody'),
    otdrCableSelect: byId<HTMLSelectElement>('otdr-cable-select'),
    otdrProvenanceBadge: byId('otdr-provenance-badge'),
    optFiberVal: byId('opt-fiber-val'),
    optSpanVal: byId('opt-span-val'),
    otdrOsnrEl: byId('otdr-osnr'),
    optQVal: byId('opt-q-val'),
    optBerVal: byId('opt-ber-val'),
    optDispVal: byId('opt-disp-val'),
    otdrPfeEl: byId('otdr-pfe'),
    pfeCurrentVal: byId('pfe-current-val'),
    otdrDepthEl: byId('otdr-depth'),
    otdrNotesBox: byId('otdr-notes-box'),
    seabedOtdrCanvas: byId<HTMLCanvasElement>('seabed-otdr-canvas'),
    btnDiveCable: byId<HTMLButtonElement>('btn-dive-cable'),
    btnAboutCable: byId<HTMLButtonElement>('btn-about-cable'),
    btnOtdrAction: byId<HTMLButtonElement>('btn-otdr-action'),
    inlineAssumptionsBody: byId('inline-assumptions-body'),

    repairTimelineCard: byId('repair-timeline-card'),
    repairEtrPill: byId('repair-etr-pill'),
    repairProgressFill: byId('repair-progress-fill'),
    repairSummaryBox: byId('repair-summary-box'),
    repairStepsList: byId('repair-steps-list'),
    cableSearchInput: byId<HTMLInputElement>('cable-search'),
    cablesList: byId('cables-list'),
    eventsFilterBar: byId('events-filter-bar'),
    eventsList: byId('events-list'),

    guideDialog: byId<HTMLDialogElement>('guide-dialog'),
    glossaryFilterInput: byId<HTMLInputElement>('glossary-filter'),
    glossaryDl: byId('glossary-dl'),
    dialogAssumptionsList: byId('dialog-assumptions-list'),
    aboutCableDialog: byId<HTMLDialogElement>('about-cable-dialog'),
    aboutCableBody: byId('about-cable-body'),

    tooltipEl: byId('globe-tooltip'),
    announcerEl: byId('live-announcer'),
  };
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function announceStatus(announcerEl: HTMLElement, msg: string): void {
  announcerEl.textContent = '';
  requestAnimationFrame(() => {
    announcerEl.textContent = msg;
  });
}

export function createProjectedMarkerRenderer(
  globeMarkersEl: HTMLElement
): (markers: ProjectedMarker[]) => void {
  const markerNodePool = new Map<string, HTMLDivElement>();

  return (markers: ProjectedMarker[]) => {
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
  };
}

