import { SUBSEA_CABLES } from '../../data/networkData';
import type { SubseaRovScene } from '../../subsea/SubseaRovScene';
import { renderSeabedAndOtdr } from '../seabedOtdrCanvas';
import type { DomRefs } from '../../app/domRefs';
import type { SimulatorStore } from '../../app/store';

export function mountOpticalOtdrPanel(
  store: SimulatorStore,
  refs: DomRefs,
  subseaRov: SubseaRovScene
): () => void {
  const renderSeabedOtdrPanel = (): void => {
    const cable = SUBSEA_CABLES.find((c) => c.id === store.inspectedCableId);
    const st = store.currentSnapshot.cables.get(store.inspectedCableId);
    if (!cable || !st) return;

    const opt = st.optical;
    const pfe = st.pfe;
    const otdr = st.otdr;
    const prov = st.provenance;
    const seabed = st.seabedSample;

    refs.otdrProvenanceBadge.textContent = `${prov.routeConfidence} · ${opt.fiberStandard} (${prov.fiberPairs} FP)`;

    refs.optFiberVal.textContent = `${opt.fiberAttenuationDbPerKm} dB/km (${opt.spanCount}x${opt.spanLengthKm}km)`;
    refs.optSpanVal.textContent = `${opt.spanLossDb} dB / +${opt.edfaGainDb} dB (NF ${opt.edfaNoiseFigureDb}dB)`;
    refs.otdrOsnrEl.textContent = opt.opticalCarrierUp
      ? `${opt.gsnrDb} dB (ASE ${opt.osnrLinDb}dB)`
      : '0.0 dB (LOS)';
    refs.optQVal.textContent = opt.opticalCarrierUp
      ? `Q ${opt.qFactorDb} dB (EOL +${opt.eolMarginDb}dB)`
      : 'Q 0.0 dB (BELOW FEC)';
    refs.optBerVal.textContent = opt.opticalCarrierUp
      ? `${opt.preFecBer} -> ${opt.postFecBer}`
      : '5.0e-1 (LOF/LOS)';
    refs.optDispVal.textContent = `${opt.chromaticDispersionPsNm.toLocaleString()} ps/nm · ${opt.pmdPs} ps`;

    if (cable.isTerrestrial) {
      refs.otdrPfeEl.textContent = 'LOCAL AC/DC GRID';
      refs.pfeCurrentVal.textContent = `Terrestrial Duct (${st.repeaterCount} ILA)`;
    } else if (pfe.mode === 'double-end-bipolar') {
      refs.otdrPfeEl.textContent = `+${pfe.terminalAVoltageKv} / ${pfe.terminalBVoltageKv} kV`;
      refs.pfeCurrentVal.textContent = `${pfe.lineCurrentAmps} A · ${pfe.conductorResistanceOhmKm} Ω/km (${pfe.totalWetPlantPowerKw} kW)`;
    } else if (pfe.mode === 'single-end-reconfig') {
      refs.otdrPfeEl.textContent = `RECONFIG ${pfe.terminalAVoltageKv}/${pfe.terminalBVoltageKv} kV`;
      refs.pfeCurrentVal.textContent = `${pfe.lineCurrentAmps} A · 0V @ ${pfe.zeroVoltPositionKm}km`;
    } else {
      refs.otdrPfeEl.textContent = '0.0 kV (HVDC TRIP)';
      refs.pfeCurrentVal.textContent = `0.00 A · R_tot ${pfe.totalCableResistanceOhm} Ω`;
    }

    if (st.cutState === 'severed' || st.cutState === 'degraded') {
      refs.otdrDepthEl.textContent = `${otdr.estimatedFaultDistanceKm} ±${otdr.uncertaintyPlusMinusKm} km (${otdr.confidencePct}%)`;
      refs.btnOtdrAction.textContent = 'Mobilize Repair Vessel';
      refs.btnOtdrAction.className = 'cable-action-btn repair';
    } else if (st.cutState === 'repairing') {
      const plan = st.repairPlan;
      refs.otdrDepthEl.textContent = plan
        ? `Step ${plan.currentStepIndex + 1}/15 · ETR ${plan.remainingHours}h`
        : `${Math.round(st.repairProgress * 100)}%`;
      refs.btnOtdrAction.textContent = 'Complete Splice & Turn-Up';
      refs.btnOtdrAction.className = 'cable-action-btn splice';
    } else {
      refs.otdrDepthEl.textContent = `NOMINAL (Max ${cable.depthMaxM.toLocaleString()}m)`;
      refs.btnOtdrAction.textContent = 'Inject Fault';
      refs.btnOtdrAction.className = 'cable-action-btn cut';
    }

    refs.otdrNotesBox.textContent = otdr.localizationNotes;

    renderSeabedAndOtdr(refs.seabedOtdrCanvas, cable, st);

    // Sync 3D Underwater ROV & Ocean-Floor Simulation Stage with calculated physics
    subseaRov.updateInspection(cable, st);
    refs.subseaCableTitle.textContent = `${cable.systemCode} — ${cable.name}`;

    const absDepthM = Math.abs(st.faultDepthM ?? seabed.depthM);
    const pressureMpa = 0.101 + absDepthM * 0.01008;
    const pressureBar = Math.round(pressureMpa * 10);

    refs.subseaDepthVal.textContent = cable.isTerrestrial
      ? `Terrestrial Conduit (${seabed.actualBurialDepthM} m trench)`
      : `${absDepthM.toLocaleString()} m (${prov.maintenanceZone})`;
    refs.subseaPressureVal.textContent = cable.isTerrestrial
      ? '0.10 MPa (Atmospheric)'
      : `${pressureMpa.toFixed(1)} MPa (${pressureBar} bar) [Calc]`;
    refs.subseaTempVal.textContent = `${seabed.armorClass} · Burial ${seabed.actualBurialDepthM}m (Target ${seabed.targetBurialDepthM}m)`;
    refs.subseaArmorVal.textContent = `${seabed.sediment} · ${st.repeaterCount} EDFA Pods`;

    if (st.cutState === 'severed') {
      refs.subseaStatusBadge.textContent = `OPTICAL LOS · ${st.faultCause?.toUpperCase()}`;
      refs.subseaStatusBadge.className = 'badge badge-partitioned';
      refs.btnSubseaCut.textContent = 'Mobilize Repair Vessel';
      refs.btnSubseaCut.className = 'cable-action-btn repair';
    } else if (st.cutState === 'degraded') {
      refs.subseaStatusBadge.textContent = `DEGRADED · ${st.pfe.mode.toUpperCase()} · Q=${opt.qFactorDb}dB`;
      refs.subseaStatusBadge.className = 'badge badge-rerouted';
      refs.btnSubseaCut.textContent = 'Mobilize Repair Vessel';
      refs.btnSubseaCut.className = 'cable-action-btn repair';
    } else if (st.cutState === 'repairing') {
      const stepCode = st.repairPlan?.currentStep.code ?? 'REPAIR';
      refs.subseaStatusBadge.textContent = `${stepCode} (${Math.round(
        st.repairProgress * 100
      )}%)`;
      refs.subseaStatusBadge.className = 'badge badge-rerouted';
      refs.btnSubseaCut.textContent = 'Complete Splice';
      refs.btnSubseaCut.className = 'cable-action-btn splice';
    } else {
      refs.subseaStatusBadge.textContent = `CARRIER UP · GSNR ${opt.gsnrDb}dB · Q ${opt.qFactorDb}dB`;
      refs.subseaStatusBadge.className = 'badge badge-optimal';
      refs.btnSubseaCut.textContent = 'Inject Fault';
      refs.btnSubseaCut.className = 'cable-action-btn cut';
    }
  };

  store.on('snapshot', renderSeabedOtdrPanel);
  store.on('selection', renderSeabedOtdrPanel);
  store.on('repairTick', renderSeabedOtdrPanel);

  return renderSeabedOtdrPanel;
}

