import { SUBSEA_CABLES } from '../../data/networkData';
import type { DomRefs } from '../../app/domRefs';
import type { SimulatorStore } from '../../app/store';

export function mountHeaderPanel(store: SimulatorStore, refs: DomRefs): () => void {
  const render = (): void => {
    const s = store.currentSnapshot;
    refs.kpiCapacity.textContent = `${s.totalActiveTbps.toLocaleString()} / ${s.totalDesignTbps.toLocaleString()} Tbps`;
    const rttDelta = s.meanGlobalRttMs - s.baselineMeanRttMs;
    refs.kpiRtt.textContent =
      rttDelta > 0.2
        ? `${s.meanGlobalRttMs.toFixed(1)} ms (+${rttDelta.toFixed(1)})`
        : `${s.meanGlobalRttMs.toFixed(1)} ms`;
    refs.kpiRtt.className = `kpi-value ${
      rttDelta > 30 ? 'danger' : rttDelta > 5 ? 'warn' : ''
    }`;

    const totalFaulted = s.severedCount + s.degradedCount + s.repairingCount;
    refs.kpiSevered.textContent = `${s.severedCount} LOS / ${s.degradedCount} DEG`;
    refs.kpiSevered.className = `kpi-value ${
      s.severedCount > 0 ? 'danger' : s.degradedCount > 0 ? 'warn' : ''
    }`;

    refs.kpiRerouted.textContent = String(s.reroutedCount + s.partitionedCount);
    refs.kpiRerouted.className = `kpi-value ${
      s.partitionedCount > 0 ? 'danger' : s.reroutedCount > 0 ? 'warn' : ''
    }`;

    const activeTrace = store.getHighlightedTrace();
    if (activeTrace && activeTrace.currentCables.length > 0) {
      const codes = activeTrace.currentCables.map(
        (id) => SUBSEA_CABLES.find((c) => c.id === id)?.systemCode ?? id
      );
      refs.kpiActivePath.textContent = `${codes.join(' -> ')} (${activeTrace.currentRttMs.toFixed(1)} ms)`;
    } else if (activeTrace) {
      refs.kpiActivePath.textContent = `${activeTrace.status}`;
    } else {
      refs.kpiActivePath.textContent = '--';
    }

    if (s.partitionedCount > 0) {
      refs.globalStatusPill.textContent = 'BGP UNREACHABLE';
      refs.globalStatusPill.className = 'status-pill status-critical';
    } else if (totalFaulted > 0 || s.reroutedCount > 0) {
      refs.globalStatusPill.textContent = 'DEGRADED / REROUTED';
      refs.globalStatusPill.className = 'status-pill status-degraded';
    } else {
      refs.globalStatusPill.textContent = 'CONVERGED';
      refs.globalStatusPill.className = 'status-pill status-optimal';
    }
  };

  store.on('snapshot', render);
  store.on('selection', render);
  store.on('repairTick', render);

  return render;
}

