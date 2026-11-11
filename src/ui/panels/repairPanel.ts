import { SUBSEA_CABLES } from '../../data/networkData';
import { computeSubseaRepairPlan } from '../../sim/repairEngine';
import { escapeHtml, type DomRefs } from '../../app/domRefs';
import type { SimulatorStore } from '../../app/store';

export function mountRepairPanel(
  store: SimulatorStore,
  refs: DomRefs
): () => void {
  const renderRepairPanel = (): void => {
    const cable = SUBSEA_CABLES.find((c) => c.id === store.inspectedCableId);
    const st = store.currentSnapshot.cables.get(store.inspectedCableId);
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

    refs.repairTimelineCard.hidden = false;
    const pct =
      st.cutState === 'repairing'
        ? Math.max(4, Math.min(100, Math.round(st.repairProgress * 100)))
        : 0;
    refs.repairProgressFill.style.inlineSize = `${pct}%`;
    refs.repairEtrPill.textContent =
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
    refs.repairTimelineCard
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

    refs.repairSummaryBox.textContent = `${stateTag} | Assigned Vessel: ${plan.vessel.name} (${plan.vessel.operator}, Depot: ${plan.vessel.depotCity}, ${plan.transitDistanceNm} NM) | Depth: ${plan.waterDepthM}m | Burial: ${plan.burialDepthM}m | Sea State: Beaufort ${plan.seaStateBeaufort} (${plan.significantWaveHeightM}m) | Method: ${plan.recoveryMethod} | Spare Bight: ${plan.spareCableInsertedKm} km (${plan.universalJointCount}x UJ)`;

    refs.repairStepsList.innerHTML = '';
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
      refs.repairStepsList.appendChild(li);
    }
  };

  store.on('snapshot', renderRepairPanel);
  store.on('selection', renderRepairPanel);
  store.on('repairTick', renderRepairPanel);

  return renderRepairPanel;
}
