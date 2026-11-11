import {
  classifyHazardAtCoord,
  sampleSeabedDepthMeters,
} from '../data/bathymetry';
import {
  CORRIDOR_DEFINITIONS,
  LANDING_STATIONS,
  SUBSEA_CABLES,
} from '../data/networkData';
import {
  getCableProvenance,
  sampleCableEngineeringAtPoint,
} from '../data/provenance';
import type {
  CableRuntimeState,
  CorridorStatus,
  EventSubsystem,
  FaultCause,
  NetworkEvent,
  NetworkSnapshot,
  SubseaCable,
  TrafficCorridor,
} from '../types/network';
import {
  type BgpControlPlaneConfig,
  convergeBgpControlPlane,
} from './bgpEngine';
import { computeOpticalPerformance } from './opticalEngine';
import { computeOtdrAnalysis } from './otdrEngine';
import { type SubsystemFaultMode, computePfeState } from './pfeEngine';
import { computeSubseaRepairPlan } from './repairEngine';

// Speed of light in silica optical fiber (group index n_g ≈ 1.4682 at 1550 nm): 204.19 km/ms
export const FIBER_SPEED_KM_PER_MS = 204.19;
// Per-CLS OADM / coherent transponder / border router switching delay (one-way ms)
const CLS_FORWARDING_DELAY_MS = 1.4;

function computeCableBaseRttMs(cable: SubseaCable): number {
  const oneWayMs = cable.lengthKm / FIBER_SPEED_KM_PER_MS + CLS_FORWARDING_DELAY_MS;
  return Number((oneWayMs * 2).toFixed(1));
}

function nowTimestamp(): string {
  const d = new Date();
  return d.toISOString().substring(11, 19) + ' UTC';
}

export class RoutingEngine {
  private cableMap = new Map<string, SubseaCable>();
  private runtime = new Map<string, CableRuntimeState>();
  private baselinePaths = new Map<
    string,
    { path: string[]; cables: string[]; rttMs: number }
  >();
  private events: NetworkEvent[] = [];
  private eventSeq = 1;
  private faultClockOriginMs: number | null = null;
  private customSrcId: string | null = 'mombasa';
  private customDstId: string | null = 'marseille';
  private selectedFaultCause: FaultCause | 'Auto' = 'Auto';
  private bgpConfig: BgpControlPlaneConfig = {};

  constructor() {
    for (const cable of SUBSEA_CABLES) {
      this.cableMap.set(cable.id, cable);
      this.runtime.set(cable.id, this.buildCableState(cable, 'none', 0.5, null));
    }

    // Record converged baseline paths
    const initial = this.computeSnapshot();
    for (const c of initial.corridors) {
      this.baselinePaths.set(c.id, {
        path: c.currentPath,
        cables: c.currentCables,
        rttMs: c.currentRttMs,
      });
    }

    this.pushEvent(
      'info',
      'BGP-CONVERGED',
      `RFC 4271 BGP-4 RIBs converged across ${LANDING_STATIONS.length} AS border routers and ${SUBSEA_CABLES.length} optical trunks.`,
      'BGP'
    );
  }

  private buildCableState(
    cable: SubseaCable,
    faultMode: SubsystemFaultMode,
    progressT: number,
    faultCause: FaultCause | null,
    cutCoord: [number, number] | null = null
  ): CableRuntimeState {
    const baseLatencyMs = computeCableBaseRttMs(cable);
    const midCoord =
      cutCoord ?? cable.waypoints[Math.floor(cable.waypoints.length / 2)];
    const seabedSample = sampleCableEngineeringAtPoint(
      cable,
      midCoord[0],
      midCoord[1]
    );
    const provenance = getCableProvenance(cable);

    // 1. Evaluate nominal repeater count from ITU-T optical model
    const baseOptical = computeOpticalPerformance(cable);
    const repeaterCount = baseOptical.repeaterCount;

    // 2. Evaluate Submarine Constant-Current PFE Electrical State
    const pfe = computePfeState(cable, repeaterCount, faultMode, progressT);

    // 3. Evaluate Optical Transmission Performance (coupling PFE unpowered repeaters into EDFA chain)
    const severedOptical =
      faultMode === 'complete-cut' || faultMode === 'optical-only-cut';
    const degradedRepeaters = faultMode === 'repeater-failure' ? 2 : 0;
    const optical = computeOpticalPerformance(cable, {
      severed: severedOptical,
      unpoweredRepeaters: pfe.unpoweredRepeaterCount,
      degradedRepeaters,
    });

    // 4. Evaluate C-OTDR / LME / PFE Bridge Fault Localization & Uncertainty
    const otdr = computeOtdrAnalysis(
      cable,
      repeaterCount,
      faultMode,
      progressT
    );

    const isDown = !optical.opticalCarrierUp;
    const cutState: CableRuntimeState['cutState'] = isDown
      ? 'severed'
      : faultMode !== 'none'
      ? 'degraded'
      : 'active';

    const pfeDisplayKv =
      pfe.mode === 'double-end-bipolar'
        ? pfe.terminalAVoltageKv
        : pfe.mode === 'single-end-reconfig'
        ? Math.max(Math.abs(pfe.terminalAVoltageKv), Math.abs(pfe.terminalBVoltageKv))
        : 0;

    return {
      id: cable.id,
      cutState,
      subsystemFaultMode: faultMode,
      cutCoord: faultMode !== 'none' ? midCoord : null,
      cutProgressT: progressT,
      faultCause,
      faultDistanceKm: otdr.estimatedFaultDistanceKm,
      faultUncertaintyKm: otdr.uncertaintyPlusMinusKm,
      faultDepthM: faultMode !== 'none' ? seabedSample.depthM : null,
      repairProgress: 0,
      repairPhase: null,
      repairShip: null,
      utilization: 0,
      carriedTbps: 0,
      effectiveLatencyMs: isDown ? Infinity : baseLatencyMs,
      baseLatencyMs,
      pfeVoltageKv: pfeDisplayKv,
      repeaterCount,
      osnrDb: optical.gsnrDb,
      optical,
      pfe,
      otdr,
      seabedSample,
      provenance,
      repairPlan: null,
    };
  }

  public setSelectedFaultCause(cause: FaultCause | 'Auto'): void {
    this.selectedFaultCause = cause;
  }

  public getSelectedFaultCause(): FaultCause | 'Auto' {
    return this.selectedFaultCause;
  }

  public setBgpConfig(config: BgpControlPlaneConfig): void {
    this.bgpConfig = { ...config };
  }

  public getBgpConfig(): BgpControlPlaneConfig {
    return this.bgpConfig;
  }

  public getEvents(): NetworkEvent[] {
    return this.events;
  }

  public setCustomTraceEndpoints(srcId: string, dstId: string): void {
    this.customSrcId = srcId;
    this.customDstId = dstId;
  }

  public getCustomTraceEndpoints(): { srcId: string | null; dstId: string | null } {
    return { srcId: this.customSrcId, dstId: this.customDstId };
  }

  private formatRelativeTime(): string {
    if (this.faultClockOriginMs === null) return 'BASELINE';
    const sec = Math.max(0, Math.floor((Date.now() - this.faultClockOriginMs) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `T+${mm}:${ss}`;
  }

  private pushEvent(
    severity: NetworkEvent['severity'],
    code: string,
    message: string,
    subsystem: EventSubsystem = 'System'
  ): void {
    this.events.unshift({
      id: `evt-${this.eventSeq++}`,
      timestamp: nowTimestamp(),
      relativeTime: this.formatRelativeTime(),
      subsystem,
      severity,
      code,
      message,
    });
    if (this.events.length > 80) {
      this.events.length = 80;
    }
  }

  public severCable(
    cableId: string,
    cutCoord?: [number, number],
    cutProgressT = 0.5,
    overrideCause?: FaultCause,
    overrideFaultMode?: SubsystemFaultMode
  ): boolean {
    const cable = this.cableMap.get(cableId);
    const prevState = this.runtime.get(cableId);
    if (!cable || !prevState || prevState.cutState === 'severed') return false;

    const midIdx = Math.floor(cable.waypoints.length / 2);
    const resolvedCoord = cutCoord ?? cable.waypoints[midIdx];
    const depthM = cable.isTerrestrial
      ? 0
      : sampleSeabedDepthMeters(resolvedCoord[0], resolvedCoord[1]);

    const cause: FaultCause =
      overrideCause ??
      (this.selectedFaultCause !== 'Auto'
        ? this.selectedFaultCause
        : cable.isTerrestrial
        ? 'Anchor Drag'
        : classifyHazardAtCoord(resolvedCoord[0], resolvedCoord[1], depthM));

    // Map FaultCause to physical subsystem fault mode unless explicitly overridden
    const faultMode: SubsystemFaultMode =
      overrideFaultMode ??
      (cause === 'Repeater Pump Failure'
        ? 'repeater-failure'
        : cause === 'Shore PFE Terminal Outage'
        ? 'single-pfe-outage'
        : 'complete-cut');

    if (this.faultClockOriginMs === null) {
      this.faultClockOriginMs = Date.now();
    }

    const nextState = this.buildCableState(
      cable,
      faultMode,
      cutProgressT,
      cause,
      resolvedCoord
    );
    this.runtime.set(cableId, nextState);

    if (nextState.cutState === 'severed') {
      this.pushEvent(
        'critical',
        'OPT-LINK-DOWN',
        `${cable.systemCode}: Cable fault detected (${cause}) at est. ${nextState.faultDistanceKm} km (±${nextState.faultUncertaintyKm} km, ${Math.abs(depthM)}m depth). Optical link unavailable; BGP routes withdrawn.`,
        'Optical'
      );
    } else {
      const sub: EventSubsystem =
        faultMode === 'repeater-failure' ? 'Optical' : 'PFE';
      this.pushEvent(
        'warning',
        sub === 'Optical' ? 'OPT-REPEATER-DEG' : 'PFE-RECONFIG',
        `${cable.systemCode}: ${cause} at est. ${nextState.faultDistanceKm} km (±${nextState.faultUncertaintyKm} km). PFE reconfigured (${nextState.pfe.mode}); optical carrier remains UP (Q=${nextState.optical.qFactorDb} dB, GSNR=${nextState.osnrDb} dB).`,
        sub
      );
    }
    return true;
  }

  public dispatchRepairShip(cableId: string): boolean {
    const cable = this.cableMap.get(cableId);
    const state = this.runtime.get(cableId);
    if (
      !cable ||
      !state ||
      (state.cutState !== 'severed' && state.cutState !== 'degraded')
    ) {
      return false;
    }

    const faultCoord =
      state.cutCoord ?? cable.waypoints[Math.floor(cable.waypoints.length / 2)];
    const plan = computeSubseaRepairPlan(cable, faultCoord, 0.04);

    state.cutState = 'repairing';
    state.repairProgress = 0.04;
    state.repairPhase = plan.currentStep.legacyPhase;
    state.repairShip = plan.vessel.name;
    state.repairPlan = plan;

    this.pushEvent(
      'warning',
      'VESSEL-MOBILIZED',
      `${plan.vessel.name} (${plan.vessel.depotCity}) mobilized for ${cable.systemCode} (${plan.transitDistanceNm} NM transit, ${plan.waterDepthM}m depth, ${plan.recoveryMethod}, ETR ${plan.totalEstimatedHours}h).`,
      'Repair'
    );
    return true;
  }

  public restoreCable(cableId: string, silent = false): boolean {
    const cable = this.cableMap.get(cableId);
    const state = this.runtime.get(cableId);
    if (!cable || !state || (state.cutState === 'active' && state.subsystemFaultMode === 'none')) {
      return false;
    }

    const restoredState = this.buildCableState(cable, 'none', 0.5, null);
    this.runtime.set(cableId, restoredState);

    if (!silent) {
      this.pushEvent(
        'recovery',
        'SERVICE-RESTORED',
        `${cable.systemCode}: Splice testing & PFE ±${restoredState.pfeVoltageKv} kV ramp complete. GSNR ${restoredState.osnrDb} dB (Q=${restoredState.optical.qFactorDb} dB); BGP adjacency restored.`,
        'Optical'
      );
    }
    return true;
  }

  public restoreAll(): number {
    let count = 0;
    this.bgpConfig = {};
    for (const [id] of this.runtime) {
      if (this.restoreCable(id, true)) count++;
    }
    this.pushEvent(
      'recovery',
      'BASELINE-RESTORED',
      `Restored deterministic baseline (${count} trunk(s) repaired, BGP policy filters & anomalies cleared).`,
      'System'
    );
    this.faultClockOriginMs = null;
    return count;
  }

  public applyScenario(
    cableIds: string[],
    scenarioName: string,
    cause?: FaultCause,
    subsystemFaultMode?: SubsystemFaultMode,
    bgpConfig?: BgpControlPlaneConfig
  ): void {
    this.bgpConfig = bgpConfig ? { ...bgpConfig } : {};
    for (const [id] of this.runtime) {
      this.restoreCable(id, true);
    }
    this.faultClockOriginMs = Date.now();
    let affected = 0;
    for (const id of cableIds) {
      if (this.severCable(id, undefined, 0.5, cause, subsystemFaultMode)) {
        affected++;
      }
    }

    if (bgpConfig?.routeLeakActive) {
      this.pushEvent(
        'critical',
        'BGP-ROUTE-LEAK',
        `Scenario "${scenarioName}": AS37468 valley-free violation advertising transit prefixes with LOCAL_PREF 265 (0 physical cables cut).`,
        'BGP'
      );
    } else if (bgpConfig?.prefixHijackActive) {
      this.pushEvent(
        'critical',
        'BGP-HIJACK',
        `Scenario "${scenarioName}": Unauthorized origin AS64666 advertising forged 1-hop AS_PATH for European prefixes.`,
        'BGP'
      );
    } else if (bgpConfig?.enforceStrictCapeNoExport) {
      this.pushEvent(
        'critical',
        'BGP-POLICY-DROP',
        `Scenario "${scenarioName}": Red Sea severed; physical Cape path is UP, but AS37457 NO_EXPORT policy blocks East-West transit.`,
        'BGP'
      );
    } else if (bgpConfig?.disabledStations?.size) {
      const stList = Array.from(bgpConfig.disabledStations).join(', ').toUpperCase();
      this.pushEvent(
        'critical',
        'CLS-OUTAGE',
        `Scenario "${scenarioName}": Landing station facility power & border router outage at ${stList}.`,
        'BGP'
      );
    } else {
      this.pushEvent(
        'critical',
        'SCENARIO-ACTIVE',
        `Scenario "${scenarioName}" applied (${affected} cable system(s) impacted; C-OTDR & BGP reconvergence complete).`,
        'BGP'
      );
    }
  }

  /**
   * Advances active repair vessels through the 15-stage maritime repair sequence.
   * Rate scales inversely with totalEstimatedHours so deeper/buried repairs take longer.
   */
  public tickRepairs(dtSeconds: number): string[] {
    const completed: string[] = [];
    for (const [id, state] of this.runtime) {
      if (state.cutState === 'repairing') {
        const cable = this.cableMap.get(id)!;
        const faultCoord =
          state.cutCoord ??
          cable.waypoints[Math.floor(cable.waypoints.length / 2)];
        const prevPlan =
          state.repairPlan ??
          computeSubseaRepairPlan(cable, faultCoord, state.repairProgress);

        // Normalize simulation rate: 95h standard repair ~ 8s sim time; 165h deep repair ~ 14s sim time
        const rate = 11.5 / Math.max(60, prevPlan.totalEstimatedHours);
        state.repairProgress = Math.min(1, state.repairProgress + dtSeconds * rate);

        const nextPlan = computeSubseaRepairPlan(
          cable,
          faultCoord,
          state.repairProgress
        );
        const prevLegacy = state.repairPhase;
        state.repairPlan = nextPlan;
        state.repairPhase = nextPlan.currentStep.legacyPhase;

        if (nextPlan.currentStep.legacyPhase !== prevLegacy) {
          this.pushEvent(
            'info',
            nextPlan.currentStep.code,
            `${state.repairShip} [${cable.systemCode}]: ${nextPlan.currentStep.label} — ${nextPlan.currentStep.engineeringDetail}`,
            nextPlan.currentStep.legacyPhase === 'pfe-ramp' ? 'PFE' : 'Repair'
          );
        }

        if (state.repairProgress >= 1) {
          this.restoreCable(id);
          completed.push(id);
        }
      }
    }
    return completed;
  }

  /**
   * Computes the full network snapshot by executing:
   * 1. Physical / Optical / PFE state evaluation per cable.
   * 2. RFC 4271 BGP-4 Control Plane convergence over optically UP cables.
   * 3. Data-Plane traffic forwarding & parallel trunk load balancing across BGP-selected hops.
   */
  public computeSnapshot(): NetworkSnapshot {
    const loadMap = new Map<string, number>();
    const activeCables: SubseaCable[] = [];
    const baseLatencyMap = new Map<string, number>();

    for (const cable of SUBSEA_CABLES) {
      loadMap.set(cable.id, cable.capacityTbps * 0.18);
      const st = this.runtime.get(cable.id)!;
      baseLatencyMap.set(cable.id, st.baseLatencyMs);
      if (
        (st.cutState === 'active' || st.cutState === 'degraded') &&
        st.optical.opticalCarrierUp
      ) {
        activeCables.push(cable);
      }
    }

    // Run RFC 4271 BGP Control Plane Convergence
    const bgpResult = convergeBgpControlPlane(
      activeCables,
      baseLatencyMap,
      this.bgpConfig
    );

    const corridors: TrafficCorridor[] = [];

    for (const def of CORRIDOR_DEFINITIONS) {
      const base = this.baselinePaths.get(def.id);
      const key = `${def.srcId}->${def.dstId}`;
      const bgpRoute = bgpResult.selectedRoutes.get(key) ?? null;
      const physicallyReachable = bgpResult.physicallyReachablePairs.has(key);

      if (!bgpRoute) {
        const status: CorridorStatus = physicallyReachable
          ? 'POLICY_BLOCKED'
          : 'PARTITIONED';
        corridors.push({
          id: def.id,
          label: def.label,
          srcId: def.srcId,
          dstId: def.dstId,
          demandTbps: def.demandTbps,
          baselinePath: base?.path ?? [],
          baselineCables: base?.cables ?? [],
          baselineRttMs: base?.rttMs ?? 0,
          currentPath: [],
          currentCables: [],
          currentRttMs: Infinity,
          hops: 0,
          status,
          bottleneckUtilization: 0,
          packetLossPct: 100,
          jitterMs: 0,
          bgpRoute: null,
          physicallyReachable,
        });
        continue;
      }

      // Data-Plane Traffic Engineering Layer:
      // For each station-to-station hop selected by BGP, select the least-utilized active parallel subsea trunk
      const selectedCables = this.resolveDataPlaneCablesForStationPath(
        bgpRoute.stationPath,
        activeCables,
        loadMap,
        def.demandTbps,
        this.bgpConfig.routeLeakActive
      );

      for (const cId of selectedCables) {
        loadMap.set(cId, (loadMap.get(cId) ?? 0) + def.demandTbps);
      }

      let baseRttSum = 0;
      for (const cId of selectedCables) {
        baseRttSum += this.runtime.get(cId)!.baseLatencyMs;
      }
      baseRttSum = Number(baseRttSum.toFixed(1));

      corridors.push({
        id: def.id,
        label: def.label,
        srcId: def.srcId,
        dstId: def.dstId,
        demandTbps: def.demandTbps,
        baselinePath: base?.path ?? bgpRoute.stationPath,
        baselineCables: base?.cables ?? selectedCables,
        baselineRttMs: base?.rttMs ?? baseRttSum,
        currentPath: bgpRoute.stationPath,
        currentCables: selectedCables,
        currentRttMs: baseRttSum,
        hops: Math.max(0, bgpRoute.stationPath.length - 1),
        status: 'OPTIMAL',
        bottleneckUtilization: 0,
        packetLossPct: 0,
        jitterMs: 0.4,
        bgpRoute,
        physicallyReachable,
      });
    }

    // Update Data-Plane Utilization & M/M/1/K Queueing Delay on each cable
    let totalActiveTbps = 0;
    let totalDesignTbps = 0;
    let severedCount = 0;
    let degradedCount = 0;
    let repairingCount = 0;

    for (const cable of SUBSEA_CABLES) {
      totalDesignTbps += cable.capacityTbps;
      const state = this.runtime.get(cable.id)!;
      if (state.cutState === 'degraded') degradedCount++;

      if (
        (state.cutState === 'active' || state.cutState === 'degraded') &&
        state.optical.opticalCarrierUp
      ) {
        totalActiveTbps += cable.capacityTbps;
        const carried = loadMap.get(cable.id) ?? 0;
        const util = carried / cable.capacityTbps;
        state.carriedTbps = Number(carried.toFixed(1));
        state.utilization = Number(util.toFixed(3));
        const queuePenalty =
          util > 0.75 ? Math.pow((util - 0.75) * 4.2, 2) * 18 : 0;
        state.effectiveLatencyMs = Number(
          (state.baseLatencyMs + queuePenalty).toFixed(1)
        );
      } else {
        if (state.cutState === 'severed') severedCount++;
        if (state.cutState === 'repairing') repairingCount++;
        state.carriedTbps = 0;
        state.utilization = 0;
        state.effectiveLatencyMs = Infinity;
      }
    }

    // Finalize corridor latency, congestion, packet loss, jitter, and status
    let rttSum = 0;
    let baselineRttSum = 0;
    let reachableCount = 0;
    let reroutedCount = 0;
    let partitionedCount = 0;

    for (const c of corridors) {
      baselineRttSum += c.baselineRttMs;
      if (c.status === 'PARTITIONED' || c.status === 'POLICY_BLOCKED') {
        partitionedCount++;
        continue;
      }

      let maxUtil = 0;
      let totalEffRtt = 0;
      for (const cId of c.currentCables) {
        const st = this.runtime.get(cId)!;
        totalEffRtt += st.effectiveLatencyMs;
        if (st.utilization > maxUtil) maxUtil = st.utilization;
      }

      c.currentRttMs = Number(totalEffRtt.toFixed(1));
      c.bottleneckUtilization = Number(maxUtil.toFixed(3));
      c.packetLossPct =
        maxUtil > 0.92
          ? Number(Math.min(35, (maxUtil - 0.92) * 45).toFixed(2))
          : 0;
      c.jitterMs =
        maxUtil > 0.72
          ? Number((0.6 + Math.pow((maxUtil - 0.72) * 5, 1.8) * 3.5).toFixed(1))
          : 0.4;

      const pathChanged =
        c.currentCables.length !== c.baselineCables.length ||
        c.currentCables.some((id, idx) => id !== c.baselineCables[idx]);

      if (c.bgpRoute?.isHijack) {
        c.status = 'HIJACKED';
        c.packetLossPct = Math.max(c.packetLossPct, 14.5);
        reroutedCount++;
      } else if (maxUtil >= 0.85) {
        c.status = 'CONGESTED';
        if (pathChanged) reroutedCount++;
      } else if (pathChanged) {
        c.status = 'REROUTED';
        reroutedCount++;
      } else {
        c.status = 'OPTIMAL';
      }

      rttSum += c.currentRttMs;
      reachableCount++;
    }

    // Evaluate Custom Traceroute using BGP Loc-RIB
    let customTrace: TrafficCorridor | null = null;
    if (
      this.customSrcId &&
      this.customDstId &&
      this.customSrcId !== this.customDstId
    ) {
      const matchingCorridor = corridors.find(
        (c) => c.srcId === this.customSrcId && c.dstId === this.customDstId
      );
      if (matchingCorridor) {
        customTrace = { ...matchingCorridor, id: 'custom-trace' };
      } else {
        const srcStation = LANDING_STATIONS.find((s) => s.id === this.customSrcId);
        const dstStation = LANDING_STATIONS.find((s) => s.id === this.customDstId);
        if (srcStation && dstStation) {
          const key = `${srcStation.id}->${dstStation.id}`;
          const bgpRoute = bgpResult.selectedRoutes.get(key) ?? null;
          const physicallyReachable = bgpResult.physicallyReachablePairs.has(key);

          let curRtt = Infinity;
          let maxUtil = 0;
          let status: CorridorStatus = physicallyReachable
            ? 'POLICY_BLOCKED'
            : 'PARTITIONED';
          let curCables: string[] = [];

          if (bgpRoute) {
            curCables = this.resolveDataPlaneCablesForStationPath(
              bgpRoute.stationPath,
              activeCables,
              loadMap,
              10,
              this.bgpConfig.routeLeakActive
            );
            curRtt = 0;
            for (const cId of curCables) {
              const st = this.runtime.get(cId)!;
              curRtt += st.effectiveLatencyMs;
              if (st.utilization > maxUtil) maxUtil = st.utilization;
            }
            curRtt = Number(curRtt.toFixed(1));
            status = bgpRoute.isHijack
              ? 'HIJACKED'
              : maxUtil >= 0.85
              ? 'CONGESTED'
              : 'OPTIMAL';
          }

          customTrace = {
            id: 'custom-trace',
            label: `${srcStation.city} -> ${dstStation.city}`,
            srcId: srcStation.id,
            dstId: dstStation.id,
            demandTbps: 10,
            baselinePath: bgpRoute?.stationPath ?? [],
            baselineCables: curCables,
            baselineRttMs: Number.isFinite(curRtt) ? curRtt : 0,
            currentPath: bgpRoute?.stationPath ?? [],
            currentCables: curCables,
            currentRttMs: curRtt,
            hops: bgpRoute ? Math.max(0, bgpRoute.stationPath.length - 1) : 0,
            status,
            bottleneckUtilization: Number(maxUtil.toFixed(3)),
            packetLossPct:
              status === 'PARTITIONED' || status === 'POLICY_BLOCKED'
                ? 100
                : maxUtil > 0.92
                ? Number(Math.min(35, (maxUtil - 0.92) * 45).toFixed(2))
                : 0,
            jitterMs:
              maxUtil > 0.72
                ? Number((0.6 + Math.pow((maxUtil - 0.72) * 5, 1.8) * 3.5).toFixed(1))
                : 0.4,
            bgpRoute,
            physicallyReachable,
          };
        }
      }
    }

    return {
      cables: this.runtime,
      corridors,
      customTrace,
      totalActiveTbps,
      totalDesignTbps,
      meanGlobalRttMs:
        reachableCount > 0 ? Number((rttSum / reachableCount).toFixed(1)) : 0,
      baselineMeanRttMs: Number(
        (baselineRttSum / CORRIDOR_DEFINITIONS.length).toFixed(1)
      ),
      severedCount,
      degradedCount,
      repairingCount,
      reroutedCount,
      partitionedCount,
      bgpConfig: this.bgpConfig,
    };
  }

  /**
   * Resolves which physical parallel cable trunk carries a flow between each pair of
   * adjacent BGP next-hop stations.
   */
  private resolveDataPlaneCablesForStationPath(
    stationPath: string[],
    activeCables: SubseaCable[],
    loadMap: Map<string, number>,
    demandTbps: number,
    routeLeakActive?: boolean
  ): string[] {
    const chosen: string[] = [];
    for (let i = 0; i < stationPath.length - 1; i++) {
      const u = stationPath[i];
      const v = stationPath[i + 1];
      const candidates = activeCables.filter(
        (c) =>
          (c.endpoints[0] === u && c.endpoints[1] === v) ||
          (c.endpoints[0] === v && c.endpoints[1] === u)
      );
      if (candidates.length === 0) continue;

      let best = candidates[0];
      let bestScore = Infinity;
      for (const cand of candidates) {
        if (
          routeLeakActive &&
          (cand.id === 'wacs-south' ||
            cand.id === 'wacs-mid' ||
            cand.id === 'seacom-south')
        ) {
          best = cand;
          break;
        }
        const projectedUtil =
          ((loadMap.get(cand.id) ?? 0) + demandTbps) / cand.capacityTbps;
        const baseLat = this.runtime.get(cand.id)!.baseLatencyMs;
        const score = baseLat + Math.max(0, projectedUtil - 0.5) * 45;
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      chosen.push(best.id);
    }
    return chosen;
  }
}
