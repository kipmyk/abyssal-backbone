import { telemetryAudio } from '../audio/telemetryAudio';
import { LANDING_STATIONS, SUBSEA_CABLES } from '../data/networkData';
import type { GlobeScene, QualityModeSetting } from '../globe/GlobeScene';
import { STATION_ASN_MAP } from '../sim/bgpEngine';
import type { SubseaCameraMode, SubseaRovScene } from '../subsea/SubseaRovScene';
import type { FaultCause } from '../types/network';
import type { DialogsController } from '../ui/dialogs';
import type { CablesAndEventsController } from '../ui/panels/cablesAndEventsPanel';
import { renderSeabedAndOtdr } from '../ui/seabedOtdrCanvas';
import type { DomRefs } from './domRefs';
import type {
  ClickMode,
  DensityMode,
  EventFilterMode,
  SimulatorStore,
  ViewMode,
} from './store';
import { shareScenarioToUrl, type UrlUiAppliers } from './urlState';

export interface EventHandlersDeps {
  store: SimulatorStore;
  refs: DomRefs;
  globe: GlobeScene;
  subseaRov: SubseaRovScene;
  dialogs: DialogsController;
  cablesAndEvents: CablesAndEventsController;
  renderSeabedOtdrPanel: () => void;
  renderRepairPanel: () => void;
  announce: (msg: string) => void;
}

export function initStaticSelectors(store: SimulatorStore, refs: DomRefs): void {
  const sortedStations = [...LANDING_STATIONS].sort((a, b) =>
    a.city.localeCompare(b.city)
  );
  for (const s of sortedStations) {
    const asn = STATION_ASN_MAP[s.id]?.asn ?? 65000;
    const opt1 = document.createElement('option');
    opt1.value = s.id;
    opt1.textContent = `${s.city} (AS${asn})`;
    refs.traceSrcSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = s.id;
    opt2.textContent = `${s.city} (AS${asn})`;
    refs.traceDstSelect.appendChild(opt2);
  }
  refs.traceSrcSelect.value = store.traceSrcId;
  refs.traceDstSelect.value = store.traceDstId;

  for (const c of SUBSEA_CABLES) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.systemCode} — ${c.name} (${c.lengthKm.toLocaleString()} km)`;
    refs.otdrCableSelect.appendChild(opt);
  }
  refs.otdrCableSelect.value = store.inspectedCableId;
}

export function createUiAppliers(
  store: SimulatorStore,
  refs: DomRefs,
  announce: (msg: string) => void
): UrlUiAppliers & {
  setFocusMode: (enabled: boolean) => void;
  setClickMode: (mode: ClickMode) => void;
} {
  const applyViewMode = (mode: ViewMode): void => {
    store.setViewMode(mode);
    refs.appShell.dataset.viewMode = mode;
    refs.viewModeButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viewMode === mode);
    });
    refs.subseaExpandLabel.textContent =
      mode === 'subsea' ? 'Split View' : 'Maximize 3D';
  };

  const applyDensityMode = (mode: DensityMode): void => {
    store.setDensityMode(mode);
    refs.appShell.dataset.density = mode;
    refs.btnDensitySimplified.classList.toggle('active', mode === 'simplified');
    refs.btnDensityEngineering.classList.toggle('active', mode === 'engineering');
    refs.btnDensitySimplified.setAttribute(
      'aria-pressed',
      String(mode === 'simplified')
    );
    refs.btnDensityEngineering.setAttribute(
      'aria-pressed',
      String(mode === 'engineering')
    );
    announce(`Telemetry density set to ${mode} mode.`);
  };

  const applyContrastTheme = (enabled: boolean): void => {
    store.setContrastTheme(enabled);
    if (enabled) {
      refs.appShell.dataset.theme = 'high-contrast';
    } else {
      delete refs.appShell.dataset.theme;
    }
    refs.btnContrast.setAttribute('aria-pressed', String(enabled));
    refs.contrastLabel.textContent = enabled
      ? 'Standard Theme'
      : 'High Contrast';
    announce(enabled ? 'High-contrast theme enabled.' : 'Standard theme restored.');
  };

  const setFocusMode = (enabled: boolean): void => {
    store.setFocusMode(enabled);
    refs.appShell.classList.toggle('focus-mode', enabled);
    refs.btnFocusMode.setAttribute('aria-pressed', String(enabled));
    refs.btnExitFocus.hidden = !enabled;
    window.dispatchEvent(new Event('resize'));
    announce(
      enabled
        ? 'Focus mode enabled: side panels hidden. Press F or click Exit Focus Mode to restore.'
        : 'Focus mode exited: panels restored.'
    );
  };

  const setClickMode = (mode: ClickMode): void => {
    store.setClickMode(mode);
    refs.btnClickInspect.classList.toggle('active', mode === 'inspect');
    refs.btnClickFault.classList.toggle('active', mode === 'fault');
    refs.btnClickInspect.setAttribute('aria-pressed', String(mode === 'inspect'));
    refs.btnClickFault.setAttribute('aria-pressed', String(mode === 'fault'));
    announce(`Globe cable click mode set to ${mode}.`);
  };

  return {
    applyViewMode,
    applyDensityMode,
    applyContrastTheme,
    setFocusMode,
    setClickMode,
  };
}

function setupTabs(
  renderSeabedOtdrPanel: () => void,
  renderRepairPanel: () => void
): void {
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

/**
 * Registers all interactive DOM event listeners, globe synchronization hooks,
 * repair simulation tick loop, keyboard shortcuts, and canvas ResizeObserver.
 */
export function registerEventHandlers(
  deps: EventHandlersDeps,
  appliers: ReturnType<typeof createUiAppliers>
): void {
  const {
    store,
    refs,
    globe,
    subseaRov,
    dialogs,
    cablesAndEvents,
    renderSeabedOtdrPanel,
    renderRepairPanel,
    announce,
  } = deps;

  setupTabs(renderSeabedOtdrPanel, renderRepairPanel);

  // Keep 3D Globe synchronized on snapshot/selection/repair ticks
  const syncGlobeWithStore = () => {
    const highlighted = store.getHighlightedTrace();
    globe.setInspectedCable(store.inspectedCableId);
    globe.updateSnapshot(
      store.currentSnapshot,
      highlighted?.currentCables ?? [],
      highlighted ? [highlighted.srcId, highlighted.dstId] : []
    );
  };
  store.on('snapshot', syncGlobeWithStore);
  store.on('selection', syncGlobeWithStore);
  store.on('repairTick', syncGlobeWithStore);

  // Animation & Continuous Repair Progression Tick
  globe.setOnTick((dt) => {
    const completed = store.engine.tickRepairs(dt);
    if (completed.length > 0) {
      telemetryAudio.playRepairSplice();
      store.refreshSnapshot('full');
      announce(`Service restored on: ${completed.join(', ')}`);
      return;
    }

    if (store.currentSnapshot.repairingCount > 0) {
      store.repairTickAccumulator += dt;
      if (store.repairTickAccumulator >= 0.25) {
        store.repairTickAccumulator = 0;
        store.refreshSnapshot('repairTick');
      }
    }
  });

  // Top Bar Controls
  refs.btnAudio.addEventListener('click', () => {
    const next = !telemetryAudio.isEnabled();
    telemetryAudio.setEnabled(next);
    refs.btnAudio.setAttribute('aria-pressed', String(next));
    refs.audioLabel.textContent = next ? 'Audio: On' : 'Audio: Muted';
    if (next) telemetryAudio.playHoverTick();
  });

  refs.btnPauseMotion.addEventListener('click', () => {
    const paused = !store.motionPaused;
    store.setMotionPaused(paused);
    globe.setMotionPaused(paused);
    subseaRov.setMotionPaused(paused);
    const labelSpan = refs.btnPauseMotion.querySelector('span')!;
    labelSpan.textContent = paused ? 'Resume' : 'Pause';
  });

  refs.viewModeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn.dataset.viewMode as ViewMode) ?? 'split';
      appliers.applyViewMode(mode);
    });
  });

  refs.btnSubseaExpand.addEventListener('click', () => {
    const next: ViewMode = store.viewMode === 'subsea' ? 'split' : 'subsea';
    appliers.applyViewMode(next);
  });

  refs.subseaCamButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const camMode = (btn.dataset.camMode as SubseaCameraMode) ?? 'orbit';
      refs.subseaCamButtons.forEach((b) => b.classList.toggle('active', b === btn));
      subseaRov.setCameraMode(camMode);
    });
  });

  refs.btnSubseaCut.addEventListener('click', () => {
    refs.btnOtdrAction.click();
  });

  refs.btnHudToggle.addEventListener('click', () => {
    const collapsed = refs.appShell.classList.toggle('hud-collapsed');
    refs.btnHudToggle.setAttribute('aria-expanded', String(!collapsed));
  });

  refs.btnRestoreAll.addEventListener('click', () => {
    store.activeScenarioId = null;
    const restored = store.engine.restoreAll();
    if (restored > 0) {
      telemetryAudio.playRepairSplice();
    }
    announce('Restored deterministic network baseline.');
    store.refreshSnapshot('full');
  });

  refs.btnDensitySimplified.addEventListener('click', () =>
    appliers.applyDensityMode('simplified')
  );
  refs.btnDensityEngineering.addEventListener('click', () =>
    appliers.applyDensityMode('engineering')
  );

  refs.btnGuide.addEventListener('click', () => dialogs.openGuideDialog());
  refs.glossaryFilterInput.addEventListener('input', () =>
    dialogs.renderGlossary(refs.glossaryFilterInput.value)
  );
  refs.btnAboutCable.addEventListener('click', () =>
    dialogs.openAboutCableDialog(store.inspectedCableId)
  );

  refs.btnContrast.addEventListener('click', () =>
    appliers.applyContrastTheme(!store.highContrastMode)
  );
  refs.btnFocusMode.addEventListener('click', () =>
    appliers.setFocusMode(!store.focusMode)
  );
  refs.btnExitFocus.addEventListener('click', () => appliers.setFocusMode(false));

  refs.btnClickInspect.addEventListener('click', () =>
    appliers.setClickMode('inspect')
  );
  refs.btnClickFault.addEventListener('click', () =>
    appliers.setClickMode('fault')
  );

  refs.btnShareScenario.addEventListener('click', () => {
    void shareScenarioToUrl(store, refs, announce);
  });

  // Left & Right Instrument Controls
  refs.faultCauseSelect.addEventListener('change', () => {
    store.engine.setSelectedFaultCause(
      refs.faultCauseSelect.value as FaultCause | 'Auto'
    );
  });

  refs.cameraPresets.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pill-btn');
    if (!btn) return;
    globe.flyTo(
      Number(btn.dataset.lat),
      Number(btn.dataset.lon),
      Number(btn.dataset.dist)
    );
  });

  refs.traceSrcSelect.addEventListener('change', () => {
    if (refs.traceSrcSelect.value === refs.traceDstSelect.value) return;
    store.setTraceEndpoints(refs.traceSrcSelect.value, refs.traceDstSelect.value);
  });

  refs.traceDstSelect.addEventListener('change', () => {
    if (refs.traceSrcSelect.value === refs.traceDstSelect.value) return;
    store.setTraceEndpoints(refs.traceSrcSelect.value, refs.traceDstSelect.value);
  });

  refs.btnSwapTrace.addEventListener('click', () => {
    const prevSrc = refs.traceSrcSelect.value;
    refs.traceSrcSelect.value = refs.traceDstSelect.value;
    refs.traceDstSelect.value = prevSrc;
    store.setTraceEndpoints(refs.traceSrcSelect.value, refs.traceDstSelect.value);
  });

  refs.oceanOpacitySlider.addEventListener('input', () => {
    const pct = Number(refs.oceanOpacitySlider.value);
    refs.oceanOpacityVal.textContent =
      pct === 0 ? 'Bathymetry Only' : `${pct}% Surface`;
    globe.setOceanOpacity(pct / 100);
  });

  refs.qualityModeSelect.addEventListener('change', () => {
    const mode = (refs.qualityModeSelect.value as QualityModeSetting) ?? 'auto';
    store.setQualityMode(mode);
    globe.setQualityMode(mode);
    if (mode === 'high' || mode === 'eco') {
      subseaRov.setQualityTier(mode);
    }
    announce(`Render quality set to ${mode}.`);
  });

  refs.chkPulses.addEventListener('change', () =>
    globe.setShowPulses(refs.chkPulses.checked)
  );
  refs.chkRepeaters.addEventListener('change', () =>
    globe.setShowRepeaters(refs.chkRepeaters.checked)
  );
  refs.chkHazards.addEventListener('change', () =>
    globe.setShowHazards(refs.chkHazards.checked)
  );
  refs.chkHeatmap.addEventListener('change', () =>
    globe.setShowHeatmap(refs.chkHeatmap.checked)
  );
  refs.chkTerminator.addEventListener('change', () =>
    globe.setShowTerminator(refs.chkTerminator.checked)
  );
  refs.chkOrbit.addEventListener('change', () =>
    globe.setAutoOrbit(refs.chkOrbit.checked)
  );

  refs.otdrCableSelect.addEventListener('change', () => {
    store.setInspectedCable(refs.otdrCableSelect.value, true);
  });

  refs.btnDiveCable.addEventListener('click', () => {
    const cable = SUBSEA_CABLES.find((c) => c.id === store.inspectedCableId);
    const st = store.currentSnapshot.cables.get(store.inspectedCableId);
    if (!cable || !st) return;
    const target =
      st.cutCoord ?? cable.waypoints[Math.floor(cable.waypoints.length / 2)];
    globe.diveTo(target[0], target[1]);
  });

  refs.btnOtdrAction.addEventListener('click', () => {
    const cableId = store.inspectedCableId;
    const st = store.currentSnapshot.cables.get(cableId);
    if (!st) return;
    if (st.cutState === 'active') {
      const selectedCause = refs.faultCauseSelect.value as FaultCause | 'Auto';
      const faultMode =
        selectedCause === 'PFE Shunt Fault'
          ? 'shunt-fault'
          : selectedCause === 'Repeater Pump Failure'
          ? 'repeater-failure'
          : selectedCause === 'Shore PFE Terminal Outage'
          ? 'single-pfe-outage'
          : undefined;
      store.engine.severCable(
        cableId,
        undefined,
        0.5,
        selectedCause === 'Auto' ? undefined : selectedCause,
        faultMode
      );
      globe.triggerShockwave(cableId);
      telemetryAudio.playCableCut();
    } else if (st.cutState === 'severed' || st.cutState === 'degraded') {
      store.engine.dispatchRepairShip(cableId);
      telemetryAudio.playRerouteChirp();
      const cableObj = SUBSEA_CABLES.find((c) => c.id === cableId);
      const focusCoord =
        st.cutCoord ??
        cableObj?.waypoints[Math.floor((cableObj?.waypoints.length ?? 2) / 2)];
      if (focusCoord) {
        globe.flyTo(focusCoord[0], focusCoord[1], 19.5);
      }
      const repairTab = document.getElementById(
        'tab-repair'
      ) as HTMLButtonElement | null;
      repairTab?.click();
      announce(`Repair vessel mobilized for ${cableObj?.name ?? cableId}.`);
    } else {
      store.engine.restoreCable(cableId);
      telemetryAudio.playRepairSplice();
    }
    store.refreshSnapshot('full');
  });

  refs.cableSearchInput.addEventListener('input', () =>
    cablesAndEvents.renderCablesList()
  );

  refs.eventsFilterBar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
      'button[data-evt-filter]'
    );
    if (!btn) return;
    const filter = (btn.dataset.evtFilter as EventFilterMode) ?? 'All';
    refs.eventsFilterBar
      .querySelectorAll<HTMLButtonElement>('button[data-evt-filter]')
      .forEach((b) => {
        const isSelected = b === btn;
        b.classList.toggle('active', isSelected);
        b.setAttribute('aria-pressed', String(isSelected));
      });
    store.setEventFilter(filter);
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
      !refs.guideDialog.open &&
      !refs.aboutCableDialog.open
    ) {
      e.preventDefault();
      appliers.setFocusMode(!store.focusMode);
    }
  });

  // Keep 2D C-OTDR & Bathymetric cross-section canvas sharp across viewport & orientation changes
  if (
    refs.seabedOtdrCanvas.parentElement &&
    typeof ResizeObserver !== 'undefined'
  ) {
    const otdrResizeObserver = new ResizeObserver(() => {
      const cable = SUBSEA_CABLES.find((c) => c.id === store.inspectedCableId);
      const st = store.currentSnapshot.cables.get(store.inspectedCableId);
      if (cable && st && refs.seabedOtdrCanvas.clientWidth > 0) {
        renderSeabedAndOtdr(refs.seabedOtdrCanvas, cable, st);
      }
    });
    otdrResizeObserver.observe(refs.seabedOtdrCanvas.parentElement);
  }
}

