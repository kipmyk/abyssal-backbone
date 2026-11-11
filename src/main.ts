import './style.css';
import { telemetryAudio } from './audio/telemetryAudio';
import {
  announceStatus,
  createProjectedMarkerRenderer,
  getDomRefs,
} from './app/domRefs';
import {
  createUiAppliers,
  initStaticSelectors,
  registerEventHandlers,
} from './app/eventHandlers';
import { setupOnboardingTour } from './app/onboardingTour';
import { SimulatorStore } from './app/store';
import { hydrateFromLocationHash } from './app/urlState';
import { SUBSEA_CABLES } from './data/networkData';
import { GlobeScene, type RenderQualityTier } from './globe/GlobeScene';
import { RoutingEngine } from './sim/routingEngine';
import { SubseaRovScene } from './subsea/SubseaRovScene';
import { initDialogsAndHints } from './ui/dialogs';
import { mountBgpInspectorPanel } from './ui/panels/bgpInspectorPanel';
import { mountCablesAndEventsPanel } from './ui/panels/cablesAndEventsPanel';
import { mountHeaderPanel } from './ui/panels/headerPanel';
import { mountImpactAndScenarios } from './ui/panels/impactAndScenarios';
import { mountOpticalOtdrPanel } from './ui/panels/opticalOtdrPanel';
import { mountRepairPanel } from './ui/panels/repairPanel';

// 1. Core Simulation Engine, Reactive Store & DOM References
const engine = new RoutingEngine();
const store = new SimulatorStore(engine);
const refs = getDomRefs();
refs.appShell.dataset.viewMode = 'split';

const announce = (msg: string) => announceStatus(refs.announcerEl, msg);
const renderProjectedMarkers = createProjectedMarkerRenderer(refs.globeMarkersEl);

// 2. 3D Viewports (ROV/Seabed Stage & Hydrographic Globe)
const subseaRov = new SubseaRovScene(refs.subseaRovContainer);

let tooltipHandler: (info: Parameters<NonNullable<ConstructorParameters<typeof GlobeScene>[1]['onHoverChange']>>[0]) => void =
  () => {};

const globe = new GlobeScene(refs.globeContainer, {
  onCableClick: (cableId, cutCoord, progressT, shiftKey) => {
    const state = store.currentSnapshot.cables.get(cableId);
    const cable = SUBSEA_CABLES.find((c) => c.id === cableId);
    if (!state || !cable) return;

    refs.otdrCableSelect.value = cableId;
    store.setInspectedCable(cableId, false);

    if (store.clickMode === 'inspect' && !shiftKey) {
      telemetryAudio.playHoverTick();
      globe.diveTo(cutCoord[0], cutCoord[1]);
      store.emit('selection', undefined);
      announce(
        `Inspecting ${cable.name} (${cable.systemCode}). Switch to Fault / Repair mode or hold Shift + click to inject a fault.`
      );
      return;
    }

    store.activeScenarioId = null;

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
    store.refreshSnapshot('full');
  },

  onStationClick: (stationId) => {
    const station = store.stationById.get(stationId);
    if (!station) return;
    telemetryAudio.playHoverTick();

    if (store.nextStationTarget === 'src') {
      if (stationId !== refs.traceDstSelect.value) {
        refs.traceSrcSelect.value = stationId;
      }
      store.nextStationTarget = 'dst';
    } else {
      if (stationId !== refs.traceSrcSelect.value) {
        refs.traceDstSelect.value = stationId;
      }
      store.nextStationTarget = 'src';
    }
    store.setTraceEndpoints(
      refs.traceSrcSelect.value,
      refs.traceDstSelect.value,
      'custom-trace'
    );
    announce(`BGP path inspection updated to ${station.city}.`);
  },

  onHoverChange: (info) => tooltipHandler(info),
  onMarkersUpdate: (markers) => renderProjectedMarkers(markers),
  onQualityChange: (tier: RenderQualityTier) => {
    store.setActiveQualityTier(tier);
    subseaRov.setQualityTier(tier);
    const labelMap: Record<RenderQualityTier, string> = {
      high: 'High',
      balanced: 'Balanced',
      eco: 'Eco',
    };
    const modePrefix = store.activeQualityMode === 'auto' ? 'Auto' : 'Manual';
    refs.qualityBadge.textContent = `Quality: ${modePrefix} (${labelMap[tier]})`;
  },
});

// 3. Populate Selectors, Mount Subscribed UI Panels & Dialogs
initStaticSelectors(store, refs);

mountHeaderPanel(store, refs);
mountImpactAndScenarios(store, refs, globe, announce);
mountBgpInspectorPanel(store, refs, globe);
const renderSeabedOtdrPanel = mountOpticalOtdrPanel(store, refs, subseaRov);
const renderRepairPanel = mountRepairPanel(store, refs);
const cablesAndEvents = mountCablesAndEventsPanel(store, refs, globe, announce);
tooltipHandler = cablesAndEvents.renderTooltip;

const dialogs = initDialogsAndHints(store, refs);
const appliers = createUiAppliers(store, refs, announce);

setupOnboardingTour({
  store,
  refs,
  openGlossaryDialog: dialogs.openGuideDialog,
  setViewMode: appliers.applyViewMode,
  setDensityMode: appliers.applyDensityMode,
  announce,
});

registerEventHandlers(
  {
    store,
    refs,
    globe,
    subseaRov,
    dialogs,
    cablesAndEvents,
    renderSeabedOtdrPanel,
    renderRepairPanel,
    announce,
  },
  appliers
);

// 4. Default Orbit Camera, Optional Hash Hydration & Initial Reactive Paint
refs.chkOrbit.checked = true;
globe.setAutoOrbit(true);
hydrateFromLocationHash(store, refs, appliers);
store.refreshSnapshot('full');
