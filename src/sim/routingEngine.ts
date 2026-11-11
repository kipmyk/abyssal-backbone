import {
  classifyHazardAtCoord,
  sampleSeabedDepthMeters,
} from '../data/bathymetry';
import {
  CORRIDOR_DEFINITIONS,
  LANDING_STATIONS,
  REPAIR_SHIPS,
  SUBSEA_CABLES,
} from '../data/networkData';
import type {
  CableRuntimeState,
  CorridorStatus,
  FaultCause,
  NetworkEvent,
  NetworkSnapshot,
  RepairPhase,
  SubseaCable,
  TrafficCorridor,
} from '../types/network';

// Speed of light in silica optical fiber (n ≈ 1.468): ~204,190 km/s -> 204.19 km/ms
const FIBER_SPEED_KM_PER_MS = 204.19;
// Per-hop OADM / repeater / router forwarding overhead (one-way ms)
const HOP_OVERHEAD_ONE_WAY_MS = 1.4;

function computeCableBaseRttMs(cable: SubseaCable): number {
  const oneWayMs = cable.lengthKm / FIBER_SPEED_KM_PER_MS + HOP_OVERHEAD_ONE_WAY_MS;
  return Number((oneWayMs * 2).toFixed(1));
}

function computeRepeaterCount(cable: SubseaCable): number {
  return cable.isTerrestrial
    ? Math.max(1, Math.floor(cable.lengthKm / 85))
    : Math.max(1, Math.floor(cable.lengthKm / 95));
}

function computeNominalPfeKv(cable: SubseaCable, repeaters: number): number {
  if (cable.isTerrestrial) return 0;
  return Number(Math.min(14.8, 1.6 + repeaters * 0.145).toFixed(1));
}

function computeNominalOsnrDb(repeaters: number): number {
  return Number(
    Math.max(14.2, 23.4 - Math.log10(Math.max(1, repeaters)) * 3.2).toFixed(1)
  );
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
  private baselineLoads = new Map<string, number>();
  private events: NetworkEvent[] = [];
  private eventSeq = 1;
  private customSrcId: string | null = 'mombasa';
  private customDstId: string | null = 'marseille';
  private selectedFaultCause: FaultCause | 'Auto' = 'Auto';
  private shipCounter = 0;

  constructor() {
    for (const cable of SUBSEA_CABLES) {
      this.cableMap.set(cable.id, cable);
      const baseLatencyMs = computeCableBaseRttMs(cable);
      const repeaterCount = computeRepeaterCount(cable);
      this.runtime.set(cable.id, {
        id: cable.id,
        cutState: 'active',
        cutCoord: null,
        cutProgressT: 0.5,
        faultCause: null,
        faultDistanceKm: null,
        faultDepthM: null,
        repairProgress: 0,
        repairPhase: null,
        repairShip: null,
        utilization: 0,
        carriedTbps: 0,
        effectiveLatencyMs: baseLatencyMs,
        baseLatencyMs,
        pfeVoltageKv: computeNominalPfeKv(cable, repeaterCount),
        repeaterCount,
        osnrDb: computeNominalOsnrDb(repeaterCount),
      });
    }

    // Compute initial healthy baseline paths with sequential load-aware routing
    const initial = this.computeSnapshot();
    for (const c of initial.corridors) {
      this.baselinePaths.set(c.id, {
        path: c.currentPath,
        cables: c.currentCables,
        rttMs: c.currentRttMs,
      });
    }
    for (const [id, st] of initial.cables) {
      this.baselineLoads.set(id, st.carriedTbps);
    }

    this.pushEvent(
      'info',
      'BGP-INIT',
      `Converged ${SUBSEA_CABLES.length} optical systems across ${LANDING_STATIONS.length} CLS hubs; PFE & EDFA repeaters nominal.`
    );
  }

  public setSelectedFaultCause(cause: FaultCause | 'Auto'): void {
    this.selectedFaultCause = cause;
  }

  public getSelectedFaultCause(): FaultCause | 'Auto' {
    return this.selectedFaultCause;
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

  private pushEvent(
    severity: NetworkEvent['severity'],
    code: string,
    message: string
  ): void {
    this.events.unshift({
      id: `evt-${this.eventSeq++}`,
      timestamp: nowTimestamp(),
      severity,
      code,
      message,
    });
    if (this.events.length > 70) {
      this.events.length = 70;
    }
  }

  public severCable(
    cableId: string,
    cutCoord?: [number, number],
    cutProgressT = 0.5,
    overrideCause?: FaultCause
  ): boolean {
    const cable = this.cableMap.get(cableId);
    const state = this.runtime.get(cableId);
    if (!cable || !state || state.cutState === 'severed') return false;

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

    const distKm = Number((cable.lengthKm * cutProgressT).toFixed(1));

    state.cutState = 'severed';
    state.cutCoord = resolvedCoord;
    state.cutProgressT = cutProgressT;
    state.faultCause = cause;
    state.faultDistanceKm = distKm;
    state.faultDepthM = depthM;
    state.repairProgress = 0;
    state.repairPhase = null;
    state.repairShip = null;
    state.pfeVoltageKv = 0;
    state.osnrDb = 0;

    this.pushEvent(
      'critical',
      'OTDR-LOS',
      `${cable.systemCode}: ${cause} at ${distKm.toLocaleString()} km (${Math.abs(depthM).toLocaleString()}m depth) — PFE tripped, ${cable.capacityTbps} Tbps offline.`
    );
    return true;
  }

  public dispatchRepairShip(cableId: string): boolean {
    const cable = this.cableMap.get(cableId);
    const state = this.runtime.get(cableId);
    if (!cable || !state || state.cutState !== 'severed') return false;

    const ship = REPAIR_SHIPS[this.shipCounter % REPAIR_SHIPS.length];
    this.shipCounter++;
    state.cutState = 'repairing';
    state.repairProgress = 0.02;
    state.repairPhase = 'steaming';
    state.repairShip = ship;

    this.pushEvent(
      'warning',
      'CS-DISPATCH',
      `${ship} steaming to ${cable.systemCode} fault (${Math.abs(state.faultDepthM ?? cable.depthMaxM).toLocaleString()}m seabed).`
    );
    return true;
  }

  public restoreCable(cableId: string, silent = false): boolean {
    const cable = this.cableMap.get(cableId);
    const state = this.runtime.get(cableId);
    if (!cable || !state || state.cutState === 'active') return false;

    state.cutState = 'active';
    state.cutCoord = null;
    state.faultCause = null;
    state.faultDistanceKm = null;
    state.faultDepthM = null;
    state.repairProgress = 0;
    state.repairPhase = null;
    state.repairShip = null;
    state.pfeVoltageKv = computeNominalPfeKv(cable, state.repeaterCount);
    state.osnrDb = computeNominalOsnrDb(state.repeaterCount);

    if (!silent) {
      this.pushEvent(
        'recovery',
        'PFE-LOCK',
        `${cable.systemCode} spliced & PFE ±${state.pfeVoltageKv} kV restored — OSNR ${state.osnrDb} dB nominal.`
      );
    }
    return true;
  }

  public restoreAll(): number {
    let count = 0;
    for (const [id] of this.runtime) {
      if (this.restoreCable(id, true)) count++;
    }
    if (count > 0) {
      this.pushEvent(
        'recovery',
        'GLOBAL-RESTORE',
        `Restored ${count} subsea trunk(s); PFE DC buses energized and BGP tables converged.`
      );
    }
    return count;
  }

  public applyScenario(
    cableIds: string[],
    scenarioName: string,
    cause?: FaultCause
  ): void {
    for (const [id] of this.runtime) {
      this.restoreCable(id, true);
    }
    let cut = 0;
    for (const id of cableIds) {
      if (this.severCable(id, undefined, 0.5, cause)) cut++;
    }
    this.pushEvent(
      'critical',
      'SCENARIO-EXEC',
      `Scenario "${scenarioName}" active (${cut} trunks severed; OTDR fault localization complete).`
    );
  }

  /**
   * Advances active repair vessels through steaming -> ROV/grappling -> deck splicing -> PFE ramp.
   */
  public tickRepairs(dtSeconds: number): string[] {
    const completed: string[] = [];
    for (const [id, state] of this.runtime) {
      if (state.cutState === 'repairing') {
        const depthAbs = Math.abs(state.faultDepthM ?? 2000);
        // Deeper trenches require slower grapnel recovery
        const rate = Math.max(0.085, 0.17 - (depthAbs / 8000) * 0.085);
        state.repairProgress += dtSeconds * rate;

        let nextPhase: RepairPhase = 'steaming';
        if (state.repairProgress >= 0.86) nextPhase = 'pfe-ramp';
        else if (state.repairProgress >= 0.58) nextPhase = 'splicing';
        else if (state.repairProgress >= 0.3) nextPhase = 'grappling';

        if (nextPhase !== state.repairPhase) {
          state.repairPhase = nextPhase;
          const cable = this.cableMap.get(id);
          if (cable) {
            if (nextPhase === 'grappling') {
              this.pushEvent(
                'info',
                'ROV-DEPLOY',
                `${state.repairShip} lowering grapnel/ROV to ${depthAbs.toLocaleString()}m on ${cable.systemCode}.`
              );
            } else if (nextPhase === 'splicing') {
              this.pushEvent(
                'info',
                'OPT-SPLICE',
                `${state.repairShip} fusion-splicing ${cable.systemCode} fiber pairs in shipboard cleanroom.`
              );
            } else if (nextPhase === 'pfe-ramp') {
              this.pushEvent(
                'info',
                'PFE-RAMP',
                `Ramping PFE power feed on ${cable.systemCode} repeaters prior to traffic cutover.`
              );
            }
          }
        }

        if (state.repairProgress >= 1) {
          this.restoreCable(id);
          completed.push(id);
        }
      }
    }
    return completed;
  }

  public computeSnapshot(): NetworkSnapshot {
    const loadMap = new Map<string, number>();
    for (const cable of SUBSEA_CABLES) {
      loadMap.set(cable.id, cable.capacityTbps * 0.2);
    }

    const corridors: TrafficCorridor[] = [];

    for (const def of CORRIDOR_DEFINITIONS) {
      const base = this.baselinePaths.get(def.id);
      const route = this.findShortestPath(
        def.srcId,
        def.dstId,
        loadMap,
        false,
        def.demandTbps
      );

      if (!route) {
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
          status: 'PARTITIONED',
          bottleneckUtilization: 0,
          packetLossPct: 100,
          jitterMs: 0,
        });
        continue;
      }

      for (const cId of route.cables) {
        loadMap.set(cId, (loadMap.get(cId) ?? 0) + def.demandTbps);
      }

      corridors.push({
        id: def.id,
        label: def.label,
        srcId: def.srcId,
        dstId: def.dstId,
        demandTbps: def.demandTbps,
        baselinePath: base?.path ?? route.path,
        baselineCables: base?.cables ?? route.cables,
        baselineRttMs: base?.rttMs ?? route.rttMs,
        currentPath: route.path,
        currentCables: route.cables,
        currentRttMs: route.rttMs,
        hops: Math.max(0, route.path.length - 1),
        status: 'OPTIMAL',
        bottleneckUtilization: 0,
        packetLossPct: 0,
        jitterMs: 0.4,
      });
    }

    let totalActiveTbps = 0;
    let totalDesignTbps = 0;
    let severedCount = 0;
    let repairingCount = 0;

    for (const cable of SUBSEA_CABLES) {
      totalDesignTbps += cable.capacityTbps;
      const state = this.runtime.get(cable.id)!;
      if (state.cutState === 'active') {
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

    let rttSum = 0;
    let baselineRttSum = 0;
    let reachableCount = 0;
    let reroutedCount = 0;
    let partitionedCount = 0;

    for (const c of corridors) {
      baselineRttSum += c.baselineRttMs;
      if (c.status === 'PARTITIONED') {
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
        maxUtil > 0.92 ? Number(Math.min(28, (maxUtil - 0.92) * 42).toFixed(2)) : 0;
      c.jitterMs =
        maxUtil > 0.72
          ? Number((0.6 + Math.pow((maxUtil - 0.72) * 5, 1.8) * 3.5).toFixed(1))
          : 0.4;

      const pathChanged =
        c.currentCables.length !== c.baselineCables.length ||
        c.currentCables.some((id, idx) => id !== c.baselineCables[idx]);

      let status: CorridorStatus = 'OPTIMAL';
      if (maxUtil >= 0.85) {
        status = 'CONGESTED';
      } else if (pathChanged) {
        status = 'REROUTED';
      }
      if (pathChanged) reroutedCount++;
      c.status = status;

      rttSum += c.currentRttMs;
      reachableCount++;
    }

    let customTrace: TrafficCorridor | null = null;
    if (
      this.customSrcId &&
      this.customDstId &&
      this.customSrcId !== this.customDstId
    ) {
      const srcStation = LANDING_STATIONS.find((s) => s.id === this.customSrcId);
      const dstStation = LANDING_STATIONS.find((s) => s.id === this.customDstId);
      if (srcStation && dstStation) {
        const matchingCorridor = corridors.find(
          (c) => c.srcId === this.customSrcId && c.dstId === this.customDstId
        );
        if (matchingCorridor) {
          customTrace = {
            ...matchingCorridor,
            id: 'custom-trace',
          };
        } else {
          const baseTrace = this.findShortestPath(
            this.customSrcId,
            this.customDstId,
            this.baselineLoads,
            true
          );
          const curTrace = this.findShortestPath(
            this.customSrcId,
            this.customDstId,
            loadMap
          );

          let curRtt = Infinity;
          let maxUtil = 0;
          let status: CorridorStatus = 'PARTITIONED';

          if (curTrace) {
            curRtt = 0;
            for (const cId of curTrace.cables) {
              const st = this.runtime.get(cId)!;
              curRtt += st.effectiveLatencyMs;
              if (st.utilization > maxUtil) maxUtil = st.utilization;
            }
            curRtt = Number(curRtt.toFixed(1));
            const changed =
              !baseTrace ||
              curTrace.cables.length !== baseTrace.cables.length ||
              curTrace.cables.some((id, idx) => id !== baseTrace.cables[idx]);
            status =
              maxUtil >= 0.85 ? 'CONGESTED' : changed ? 'REROUTED' : 'OPTIMAL';
          }

          customTrace = {
            id: 'custom-trace',
            label: `${srcStation.city} -> ${dstStation.city}`,
            srcId: srcStation.id,
            dstId: dstStation.id,
            demandTbps: 10,
            baselinePath: baseTrace?.path ?? [],
            baselineCables: baseTrace?.cables ?? [],
            baselineRttMs: baseTrace?.rttMs ?? 0,
            currentPath: curTrace?.path ?? [],
            currentCables: curTrace?.cables ?? [],
            currentRttMs: curRtt,
            hops: curTrace ? Math.max(0, curTrace.path.length - 1) : 0,
            status,
            bottleneckUtilization: Number(maxUtil.toFixed(3)),
            packetLossPct:
              status === 'PARTITIONED'
                ? 100
                : maxUtil > 0.92
                ? Number(Math.min(28, (maxUtil - 0.92) * 42).toFixed(2))
                : 0,
            jitterMs:
              maxUtil > 0.72
                ? Number((0.6 + Math.pow((maxUtil - 0.72) * 5, 1.8) * 3.5).toFixed(1))
                : 0.4,
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
      repairingCount,
      reroutedCount,
      partitionedCount,
    };
  }

  private findShortestPath(
    srcId: string,
    dstId: string,
    loadEstimate: Map<string, number>,
    ignoreCuts = false,
    demandTbps = 10
  ): { path: string[]; cables: string[]; rttMs: number } | null {
    const dist = new Map<string, number>();
    const prevNode = new Map<string, string>();
    const prevCable = new Map<string, string>();
    const visited = new Set<string>();

    for (const s of LANDING_STATIONS) {
      dist.set(s.id, Infinity);
    }
    dist.set(srcId, 0);

    const adj = new Map<
      string,
      Array<{ to: string; cable: SubseaCable; weight: number; rtt: number }>
    >();
    for (const s of LANDING_STATIONS) {
      adj.set(s.id, []);
    }

    for (const cable of SUBSEA_CABLES) {
      const state = this.runtime.get(cable.id)!;
      if (!ignoreCuts && state.cutState !== 'active') continue;

      const estLoad =
        (loadEstimate.get(cable.id) ?? cable.capacityTbps * 0.2) + demandTbps;
      const util = estLoad / cable.capacityTbps;
      const congestionPenalty =
        util > 0.72 ? Math.pow((util - 0.72) * 5, 2) * 18 : 0;
      const weight = state.baseLatencyMs + congestionPenalty;

      const [a, b] = cable.endpoints;
      adj.get(a)?.push({ to: b, cable, weight, rtt: state.baseLatencyMs });
      adj.get(b)?.push({ to: a, cable, weight, rtt: state.baseLatencyMs });
    }

    while (true) {
      let u: string | null = null;
      let minD = Infinity;
      for (const [nodeId, d] of dist) {
        if (!visited.has(nodeId) && d < minD) {
          minD = d;
          u = nodeId;
        }
      }
      if (!u || minD === Infinity || u === dstId) break;
      visited.add(u);

      for (const edge of adj.get(u) ?? []) {
        if (visited.has(edge.to)) continue;
        const alt = minD + edge.weight;
        if (alt < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, alt);
          prevNode.set(edge.to, u);
          prevCable.set(edge.to, edge.cable.id);
        }
      }
    }

    if (!prevNode.has(dstId) && srcId !== dstId) return null;

    const path: string[] = [];
    const cables: string[] = [];
    let curr: string | undefined = dstId;
    let totalRtt = 0;

    while (curr) {
      path.unshift(curr);
      const cId = prevCable.get(curr);
      if (cId) {
        cables.unshift(cId);
        totalRtt += this.runtime.get(cId)!.baseLatencyMs;
      }
      curr = prevNode.get(curr);
    }

    return {
      path,
      cables,
      rttMs: Number(totalRtt.toFixed(1)),
    };
  }
}
