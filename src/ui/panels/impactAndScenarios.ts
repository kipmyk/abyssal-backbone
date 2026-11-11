import { telemetryAudio } from '../../audio/telemetryAudio';
import { SCENARIO_PRESETS } from '../../data/networkData';
import type { GlobeScene } from '../../globe/GlobeScene';
import { computeImpactComparison } from '../../sim/shareState';
import { escapeHtml, type DomRefs } from '../../app/domRefs';
import type { SimulatorStore } from '../../app/store';

export function mountImpactAndScenarios(
  store: SimulatorStore,
  refs: DomRefs,
  globe: GlobeScene,
  announce: (msg: string) => void
): () => void {
  // Build curated fault & historical scenario preset cards once
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
      store.activeScenarioId = preset.id;
      store.engine.applyScenario(
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
        store.setInspectedCable(preset.cableIdsToCut[0], false);
        refs.otdrCableSelect.value = preset.cableIdsToCut[0];
      }

      const suggested = store.currentSnapshot.corridors.find(
        (c) => c.id === preset.suggestedCorridorId
      );
      if (suggested) {
        refs.traceSrcSelect.value = suggested.srcId;
        refs.traceDstSelect.value = suggested.dstId;
        store.setTraceEndpoints(
          suggested.srcId,
          suggested.dstId,
          suggested.id,
          false
        );
      }

      store.refreshSnapshot('full');
      store.emit('selection', undefined);
      announce(`Scenario applied: ${preset.name}`);
    });
    refs.scenarioList.appendChild(btn);
  }

  const renderScenarioButtons = (): void => {
    refs.scenarioList
      .querySelectorAll<HTMLButtonElement>('.scenario-btn')
      .forEach((btn) => {
        btn.classList.toggle(
          'active',
          btn.dataset.scenarioId === store.activeScenarioId
        );
      });
  };

  const renderHistoricalContext = (): void => {
    if (!store.activeScenarioId) {
      refs.historicalEventCard.hidden = true;
      return;
    }
    const preset = SCENARIO_PRESETS.find((p) => p.id === store.activeScenarioId);
    const hist = preset?.historicalEvent;
    if (!hist) {
      refs.historicalEventCard.hidden = true;
      return;
    }

    refs.historicalEventCard.hidden = false;
    refs.histDate.textContent = hist.date;
    refs.histSummary.textContent = hist.factualSummary;
    refs.histImpact.textContent = `Observed impact: ${hist.impactHighlight}`;
    refs.histSource.textContent = `Reference: ${hist.sourceNote}`;
  };

  const renderImpactComparison = (): void => {
    const report = computeImpactComparison(
      store.baselineSnapshot,
      store.currentSnapshot
    );
    if (!report.hasChanges) {
      refs.impactComparisonCard.hidden = true;
      return;
    }

    refs.impactComparisonCard.hidden = false;
    refs.impactBadge.textContent =
      report.impactedCorridors.length > 0
        ? `${report.impactedCorridors.length} FLOW${report.impactedCorridors.length > 1 ? 'S' : ''} SHIFTED`
        : 'TRUNK FAULT';
    refs.impactBadge.className = `badge ${
      report.impactedCorridors.length > 0 ? 'badge-rerouted' : 'badge-partitioned'
    }`;

    const capSign = report.capacityDeltaTbps > 0 ? '+' : '';
    refs.impactCapDelta.textContent = `${capSign}${report.capacityDeltaTbps} Tbps (${report.capacityDeltaPct}%)`;
    refs.impactCapDelta.className = `mono-val ${
      report.capacityDeltaTbps < 0 ? 'delta-bad' : ''
    }`;

    const rttSign = report.meanRttDeltaMs > 0 ? '+' : '';
    refs.impactRttDelta.textContent = `${rttSign}${report.meanRttDeltaMs} ms`;
    refs.impactRttDelta.className = `mono-val ${
      report.meanRttDeltaMs > 15
        ? 'delta-bad'
        : report.meanRttDeltaMs > 1
        ? 'delta-up'
        : ''
    }`;

    const trace = store.getHighlightedTrace();
    if (trace && trace.bgpRoute) {
      const baseCorridor = store.baselineSnapshot.corridors.find(
        (c) => c.id === trace.id
      );
      const prevAs =
        baseCorridor?.bgpRoute?.asPath.map((a) => `AS${a}`).join(' ') ??
        'Direct Baseline';
      const nextAs = trace.bgpRoute.asPath.map((a) => `AS${a}`).join(' ');
      refs.impactPathDiff.textContent =
        prevAs === nextAs
          ? `Inspected AS_PATH unchanged: [${nextAs}]`
          : `Inspected AS_PATH: [${prevAs}] -> [${nextAs}]`;
    } else if (trace) {
      refs.impactPathDiff.textContent = `Inspected Corridor: ${trace.status} (Route withdrawn or filtered)`;
    } else {
      refs.impactPathDiff.textContent = '';
    }

    refs.impactFlowsList.innerHTML = '';
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
        const target = store.currentSnapshot.corridors.find(
          (c) => c.id === flow.id
        );
        if (!target) return;
        refs.traceSrcSelect.value = target.srcId;
        refs.traceDstSelect.value = target.dstId;
        store.setTraceEndpoints(target.srcId, target.dstId, target.id);
        const srcSt = store.stationById.get(target.srcId);
        const dstSt = store.stationById.get(target.dstId);
        if (srcSt && dstSt) {
          globe.flyTo(
            (srcSt.lat + dstSt.lat) / 2,
            (srcSt.lon + dstSt.lon) / 2,
            24
          );
        }
      });
      li.appendChild(btn);
      refs.impactFlowsList.appendChild(li);
    }
  };

  const renderAll = (): void => {
    renderScenarioButtons();
    renderHistoricalContext();
    renderImpactComparison();
  };

  store.on('snapshot', renderAll);
  store.on('selection', renderImpactComparison);
  store.on('repairTick', renderAll);

  return renderAll;
}
