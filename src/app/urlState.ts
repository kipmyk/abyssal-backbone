import {
  hydrateEngineFromState,
  parseSimulatorHash,
  serializeSimulatorState,
} from '../sim/shareState';
import type { DomRefs } from './domRefs';
import type { DensityMode, SimulatorStore, ViewMode } from './store';

export interface UrlUiAppliers {
  applyViewMode: (mode: ViewMode) => void;
  applyDensityMode: (mode: DensityMode) => void;
  applyContrastTheme: (enabled: boolean) => void;
}

/**
 * Hydrates initial engine faults, inspected cable, trace endpoints, and layout preferences
 * from URL hash (`#s=...`) when present.
 */
export function hydrateFromLocationHash(
  store: SimulatorStore,
  refs: DomRefs,
  appliers: UrlUiAppliers,
  hash: string = location.hash
): boolean {
  const parsed = parseSimulatorHash(hash);
  if (!parsed) return false;

  store.activeScenarioId = parsed.sc ?? null;
  hydrateEngineFromState(store.engine, parsed);

  if (parsed.src && parsed.dst) {
    refs.traceSrcSelect.value = parsed.src;
    refs.traceDstSelect.value = parsed.dst;
    store.setTraceEndpoints(parsed.src, parsed.dst, 'custom-trace', false);
  }
  if (parsed.ins) {
    store.setInspectedCable(parsed.ins, false);
    refs.otdrCableSelect.value = parsed.ins;
  }
  if (parsed.vm) appliers.applyViewMode(parsed.vm);
  if (parsed.dn) appliers.applyDensityMode(parsed.dn);
  appliers.applyContrastTheme(Boolean(parsed.hc));

  return true;
}

/**
 * Encodes the current simulator snapshot + UI state into `#s=...` and copies the share URL.
 */
export async function shareScenarioToUrl(
  store: SimulatorStore,
  refs: DomRefs,
  announce: (msg: string) => void
): Promise<void> {
  const hash = serializeSimulatorState({
    snapshot: store.currentSnapshot,
    activeScenarioId: store.activeScenarioId,
    srcId: refs.traceSrcSelect.value,
    dstId: refs.traceDstSelect.value,
    inspectedCableId: store.inspectedCableId,
    viewMode:
      (refs.appShell.dataset.viewMode as ViewMode | undefined) ?? 'split',
    density: store.densityMode,
    highContrast: store.highContrastMode,
  });

  history.replaceState(null, '', hash);
  const fullUrl = window.location.href;
  try {
    await navigator.clipboard.writeText(fullUrl);
    refs.shareLabel.textContent = 'Copied Link';
  } catch {
    refs.shareLabel.textContent = 'URL Updated';
  }
  announce('Shareable scenario state encoded in browser URL.');
  setTimeout(() => {
    refs.shareLabel.textContent = 'Share';
  }, 2200);
}

