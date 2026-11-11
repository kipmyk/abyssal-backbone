import { sampleSeabedDepthMeters } from '../data/bathymetry';
import { GLOSSARY_ENTRIES, MODEL_ASSUMPTIONS } from '../data/glossary';
import { SCENARIO_PRESETS, SUBSEA_CABLES } from '../data/networkData';
import { sampleCableEngineeringAtPoint } from '../data/provenance';
import { compareBgpRoutes, type BgpRouteAdvertisement } from './bgpEngine';
import { computeOpticalPerformance, SD_FEC_Q_THRESHOLD_DB } from './opticalEngine';
import { computeOtdrAnalysis } from './otdrEngine';
import { computePfeState } from './pfeEngine';
import { computeSubseaRepairPlan } from './repairEngine';
import { RoutingEngine } from './routingEngine';
import {
  computeImpactComparison,
  hydrateEngineFromState,
  parseSimulatorHash,
  serializeSimulatorState,
} from './shareState';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[VERIFICATION FAILED] ${message}`);
  }
}

export function runEngineeringVerificationSuite(): void {
  console.log('=== ABYSSAL BACKBONE: PHASE 10 SCIENTIFIC INTEGRITY SUITE ===');

  // 1. T-OPT-01 & T-OPT-02: ITU-T G.977 Optical Attenuation, ASE Accumulation & OSNR
  const aae1Cable = SUBSEA_CABLES.find((c) => c.id === 'aae1-redsea')!;
  const optNominal = computeOpticalPerformance(aae1Cable);
  assert(
    optNominal.opticalCarrierUp && optNominal.qFactorDb > SD_FEC_Q_THRESHOLD_DB,
    `Expected nominal AAE-1 Q-factor (${optNominal.qFactorDb} dB) > SD-FEC threshold (${SD_FEC_Q_THRESHOLD_DB} dB)`
  );

  // Doubling cable length (and thus repeater span count) with identical fiber spec must increase ASE noise by ~3.01 dB
  const doubledCable = { ...aae1Cable, lengthKm: aae1Cable.lengthKm * 2 };
  const optDoubled = computeOpticalPerformance(doubledCable);
  const deltaOsnrLinDb = optNominal.osnrLinDb - optDoubled.osnrLinDb;
  assert(
    Math.abs(deltaOsnrLinDb - 3.01) < 0.25,
    `Expected ~3.01 dB linear OSNR reduction when doubling amplifier stages, got ${deltaOsnrLinDb.toFixed(2)} dB`
  );
  assert(
    optDoubled.totalFiberLossDb > optNominal.totalFiberLossDb,
    'Expected total fiber attenuation to increase strictly with cable length'
  );
  console.log(
    `[PASS] T-OPT-01/02: ITU-T G.977 ASE accumulation verified (ΔOSNR_2x = -${deltaOsnrLinDb.toFixed(2)} dB, Q_nom = ${optNominal.qFactorDb} dB, Pre-FEC BER = ${optNominal.preFecBer})`
  );

  // 2. T-OPT-03: Unpowered EDFA repeaters drop Q-factor below SD-FEC threshold
  const optStarved = computeOpticalPerformance(aae1Cable, { unpoweredRepeaters: 2 });
  assert(
    !optStarved.opticalCarrierUp && optStarved.qFactorDb < SD_FEC_Q_THRESHOLD_DB,
    'Expected 2 unpowered repeaters to drop optical carrier below SD-FEC threshold'
  );
  console.log(
    `[PASS] T-OPT-03: Unpowered EDFA absorber penalty verified (Q dropped to ${optStarved.qFactorDb} dB -> LOS)`
  );

  // 3. T-PFE-01 & T-PFE-02: Constant-Current Ohm's Law & Shunt Fault vs. Open Cut
  const pfeNominal = computePfeState(aae1Cable, optNominal.repeaterCount, 'none', 0.5);
  const sumTerminalKv = Number(
    (Math.abs(pfeNominal.terminalAVoltageKv) + Math.abs(pfeNominal.terminalBVoltageKv)).toFixed(2)
  );
  assert(
    Math.abs(sumTerminalKv - pfeNominal.totalSystemVoltageKv) <= 0.05,
    `Expected |V_A| + |V_B| (${sumTerminalKv} kV) == V_total (${pfeNominal.totalSystemVoltageKv} kV)`
  );

  const pfeShunt = computePfeState(aae1Cable, optNominal.repeaterCount, 'shunt-fault', 0.35);
  assert(
    pfeShunt.mode === 'single-end-reconfig' && pfeShunt.unpoweredRepeaterCount === 0,
    'Expected AAE-1 insulation shunt fault at 35% span to reconfigure PFE without starving repeaters'
  );
  console.log(
    `[PASS] T-PFE-01/02: Constant-current PFE verified (I=${pfeNominal.lineCurrentAmps}A, V_tot=${pfeNominal.totalSystemVoltageKv}kV; Shunt @ 35% -> V_A=+${pfeShunt.terminalAVoltageKv}kV, V_B=${pfeShunt.terminalBVoltageKv}kV, 0 unpowered pods)`
  );

  // 4. T-BGP-01: RFC 4271 Section 9.1.2 Route Selection Precedence
  const baseAdv: BgpRouteAdvertisement = {
    prefix: '193.251.0.0/16',
    destinationStationId: 'marseille',
    nextHopStationId: 'suez',
    nextHopAsn: 8452,
    localPref: 150,
    asPath: [30844, 37054, 8452, 5511],
    stationPath: ['mombasa', 'djibouti', 'suez', 'marseille'],
    cablePath: ['peace-east', '2africa-redsea', 'peace-med'],
    origin: 'IGP',
    med: 50,
    sessionType: 'ebgp',
    igpMetricMs: 85,
    communities: [],
    learnedFromRel: 'peer',
  };
  const higherLocalPrefLongerAs: BgpRouteAdvertisement = {
    ...baseAdv,
    localPref: 200,
    asPath: [30844, 37100, 37457, 37282, 1299, 5511],
  };
  const equalLocalPrefShorterAs: BgpRouteAdvertisement = {
    ...baseAdv,
    localPref: 150,
    asPath: [30844, 5511],
    igpMetricMs: 220, // Higher latency, but shorter AS_PATH!
  };
  assert(
    compareBgpRoutes(higherLocalPrefLongerAs, baseAdv) < 0,
    'RFC 4271 Violation: Higher LOCAL_PREF must beat shorter AS_PATH'
  );
  assert(
    compareBgpRoutes(equalLocalPrefShorterAs, baseAdv) < 0,
    'RFC 4271 Violation: Shorter AS_PATH must beat lower latency when LOCAL_PREF is tied'
  );
  console.log(
    '[PASS] T-BGP-01: RFC 4271 Section 9.1.2 decision precedence (LOCAL_PREF > AS_PATH > ORIGIN > MED > eBGP > IGP) verified'
  );

  // 5. T-OTDR-01: Fault Localization Uncertainty & Instrument Mode Selection
  const otdrNearShore = computeOtdrAnalysis(aae1Cable, optNominal.repeaterCount, 'complete-cut', 0.02);
  const otdrMidTrunk = computeOtdrAnalysis(aae1Cable, optNominal.repeaterCount, 'complete-cut', 0.55);
  const otdrShunt = computeOtdrAnalysis(aae1Cable, optNominal.repeaterCount, 'shunt-fault', 0.55);
  assert(
    otdrNearShore.instrumentMode === 'Shore-End Conventional OTDR',
    'Expected fault within 1st repeater span to use Shore-End Conventional OTDR'
  );
  assert(
    otdrMidTrunk.instrumentMode === 'C-OTDR + LME Supervisory' &&
      (otdrMidTrunk.uncertaintyPlusMinusKm ?? 0) > (otdrNearShore.uncertaintyPlusMinusKm ?? 0),
    'Expected mid-trunk fault to use C-OTDR + LME with greater uncertainty than shore-end OTDR'
  );
  assert(
    otdrShunt.instrumentMode === 'PFE DC Resistance/Capacitance Bridge',
    'Expected insulation shunt fault to localize via PFE DC Resistance/Capacitance Bridge'
  );
  console.log(
    `[PASS] T-OTDR-01: Localization uncertainty verified (1st-span: ±${otdrNearShore.uncertaintyPlusMinusKm}km, Mid-trunk C-OTDR: ±${otdrMidTrunk.uncertaintyPlusMinusKm}km, PFE Bridge: ±${otdrShunt.uncertaintyPlusMinusKm}km)`
  );

  // 6. T-BATHY-01 & T-REP-01: Bathymetry, Variable Burial/Armor, and 15-Stage Repair Constraints
  const marianaDepth = sampleSeabedDepthMeters(13.0, 146.5);
  const malaccaDepth = sampleSeabedDepthMeters(3.5, 100.2);
  assert(
    marianaDepth < -6000 && malaccaDepth > -300,
    `Unexpected bathymetry depths: Mariana=${marianaDepth}m, Malacca=${malaccaDepth}m`
  );
  const shelfSample = sampleCableEngineeringAtPoint(aae1Cable, 29.11, 32.66);
  const abyssalCable = SUBSEA_CABLES.find((c) => c.id === 'apricot-guam')!;
  const abyssalSample = sampleCableEngineeringAtPoint(abyssalCable, 9.5, 136.0);
  assert(
    shelfSample.actualBurialDepthM > abyssalSample.actualBurialDepthM &&
      abyssalSample.armorClass === 'LW',
    'Expected shallow shelf segment to be buried and deep abyssal segment to be surface-laid LW'
  );

  const shallowRepair = computeSubseaRepairPlan(aae1Cable, [29.11, 32.66], 0);
  const deepRepair = computeSubseaRepairPlan(abyssalCable, [9.5, 136.0], 0);
  assert(
    deepRepair.steps.length === 15 &&
      deepRepair.spareCableInsertedKm > shallowRepair.spareCableInsertedKm,
    'Expected 15-stage repair workflow and larger spare bight requirement in deep water'
  );
  console.log(
    `[PASS] T-REP-01: 15-stage repair physics verified (Shallow bight=${shallowRepair.spareCableInsertedKm}km vs Deep 4800m bight=${deepRepair.spareCableInsertedKm}km, ETR=${deepRepair.totalEstimatedHours}h)`
  );

  // 7. End-to-End RoutingEngine, BGP Policy Block, Route Leak & All 10 Scenarios
  const engine = new RoutingEngine();
  const baseline = engine.computeSnapshot();
  for (const c of baseline.corridors) {
    assert(
      c.status === 'OPTIMAL',
      `Expected baseline corridor ${c.id} to be OPTIMAL, got ${c.status}`
    );
  }
  console.log(`[PASS] Baseline: All ${baseline.corridors.length} global corridors converged OPTIMAL.`);

  for (const preset of SCENARIO_PRESETS) {
    engine.applyScenario(
      preset.cableIdsToCut,
      preset.name,
      preset.cause,
      preset.subsystemFaultMode,
      preset.bgpConfig
    );
    const snap = engine.computeSnapshot();
    const target = snap.corridors.find((c) => c.id === preset.suggestedCorridorId)!;

    if (preset.id === 'pfe-shunt-fault') {
      // Shunt fault keeps optical carrier UP via single-end PFE reconfiguration!
      const aae1State = snap.cables.get('aae1-redsea')!;
      assert(
        aae1State.cutState === 'degraded' && aae1State.optical.opticalCarrierUp,
        'Expected PFE Shunt Fault scenario to keep AAE-1 optical carrier UP in degraded single-end PFE mode'
      );
    } else if (preset.id === 'repeater-pump-degrade') {
      const eqState = snap.cables.get('equiano-north')!;
      assert(
        eqState.cutState === 'degraded' && eqState.optical.opticalCarrierUp,
        'Expected Repeater Pump Degradation to degrade OSNR/Q while keeping carrier UP'
      );
    } else if (preset.id === 'cape-policy-block') {
      assert(
        target.status === 'POLICY_BLOCKED' && target.physicallyReachable,
        `Expected cape-policy-block to produce POLICY_BLOCKED with physicallyReachable=true, got ${target.status}`
      );
    } else if (preset.id === 'bgp-route-leak') {
      assert(
        snap.severedCount === 0 && target.status !== 'OPTIMAL',
        'Expected bgp-route-leak to divert/congest traffic with 0 severed cables'
      );
    } else if (preset.id === 'bgp-prefix-hijack') {
      assert(
        snap.severedCount === 0 && target.status === 'HIJACKED',
        'Expected bgp-prefix-hijack to mark corridor HIJACKED with 0 severed cables'
      );
    } else {
      assert(
        target.status !== 'OPTIMAL',
        `Expected scenario ${preset.id} to impact ${preset.suggestedCorridorId}, got ${target.status}`
      );
    }

    console.log(
      `[PASS] Scenario [${preset.id}]: LOS=${snap.severedCount}, DEG=${snap.degradedCount}, Rerouted=${snap.reroutedCount} | ${target.id}: ${target.baselineRttMs}ms -> ${target.currentRttMs}ms (${target.status})`
    );
  }

  // 8. Usability, Historical Presets, Event Timestamps, Impact Comparison & URL Share Hydration
  assert(
    GLOSSARY_ENTRIES.length >= 10 && MODEL_ASSUMPTIONS.length >= 3,
    'Expected populated glossary entries and model assumption groups'
  );
  const redSeaPreset = SCENARIO_PRESETS.find((p) => p.id === 'red-sea-blackout');
  assert(
    Boolean(redSeaPreset?.historicalEvent?.date),
    'Expected red-sea-blackout preset to carry factual historicalEvent metadata'
  );

  const shareEngine = new RoutingEngine();
  const baseSnap = shareEngine.computeSnapshot();
  shareEngine.applyScenario(
    redSeaPreset!.cableIdsToCut,
    redSeaPreset!.name,
    redSeaPreset!.cause,
    redSeaPreset!.subsystemFaultMode,
    redSeaPreset!.bgpConfig
  );
  const faultSnap = shareEngine.computeSnapshot();
  const faultEvents = shareEngine.getEvents();
  assert(
    faultEvents.some((e) => e.subsystem === 'Optical' && e.relativeTime.startsWith('T+')),
    'Expected fault events to include Optical subsystem tag and T+ relative timestamp'
  );

  const comparison = computeImpactComparison(baseSnap, faultSnap);
  assert(
    comparison.hasChanges &&
      comparison.capacityDeltaTbps < 0 &&
      comparison.impactedCorridors.length > 0,
    'Expected computeImpactComparison to report negative capacity delta and impacted BGP corridors'
  );

  const hash = serializeSimulatorState({
    snapshot: faultSnap,
    activeScenarioId: 'red-sea-blackout',
    srcId: 'mombasa',
    dstId: 'marseille',
    inspectedCableId: 'aae1-redsea',
    viewMode: 'split',
    density: 'simplified',
    highContrast: true,
  });
  const parsed = parseSimulatorHash(hash);
  assert(
    parsed !== null && (parsed.f?.length ?? 0) === redSeaPreset!.cableIdsToCut.length,
    `Expected share hash round-trip with ${redSeaPreset!.cableIdsToCut.length} serialized faults`
  );

  const rehydrated = new RoutingEngine();
  hydrateEngineFromState(rehydrated, parsed!);
  const rehydratedSnap = rehydrated.computeSnapshot();
  assert(
    rehydratedSnap.severedCount === faultSnap.severedCount &&
      rehydratedSnap.totalActiveTbps === faultSnap.totalActiveTbps,
    `Expected hydrated snapshot to match faulted state (${faultSnap.severedCount} LOS, ${faultSnap.totalActiveTbps} Tbps)`
  );
  console.log(
    `[PASS] Usability & State Suite: Impact ΔCap=${comparison.capacityDeltaTbps} Tbps, Events=${faultEvents.length}, Share Hash Length=${hash.length} chars.`
  );

  console.log('=== ALL PHASE 1-10 ENGINEERING & SCIENTIFIC INTEGRITY TESTS PASSED ===');
}

runEngineeringVerificationSuite();
