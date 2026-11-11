import { LANDING_STATIONS, SCENARIO_PRESETS, SUBSEA_CABLES } from '../data/networkData';
import type {
  FaultCause,
  NetworkSnapshot,
  TrafficCorridor,
} from '../types/network';
import type { BgpControlPlaneConfig } from './bgpEngine';
import type { SubsystemFaultMode } from './pfeEngine';
import type { RoutingEngine } from './routingEngine';

export interface SerializedFaultItem {
  id: string;
  t: number;
  cause?: FaultCause;
  mode?: SubsystemFaultMode;
  repair?: boolean;
}

export interface SerializedScenarioState {
  v: 1;
  sc?: string | null;
  src?: string;
  dst?: string;
  ins?: string;
  vm?: 'split' | 'subsea' | 'globe';
  dn?: 'engineering' | 'simplified';
  hc?: boolean;
  f?: SerializedFaultItem[];
  bgp?: {
    ne?: boolean;
    rl?: boolean;
    ph?: boolean;
    to?: boolean;
    ds?: string[];
  };
}

export interface CorridorImpactDiff {
  id: string;
  label: string;
  status: TrafficCorridor['status'];
  beforeRttMs: number;
  afterRttMs: number;
  rttDeltaMs: number;
  beforePath: string[];
  afterPath: string[];
  beforeCables: string[];
  afterCables: string[];
  pathChanged: boolean;
}

export interface ImpactComparisonReport {
  hasChanges: boolean;
  activeTbpsBefore: number;
  activeTbpsAfter: number;
  capacityDeltaTbps: number;
  capacityDeltaPct: number;
  meanRttBefore: number;
  meanRttAfter: number;
  meanRttDeltaMs: number;
  faultedTrunksCount: number;
  impactedFlowsCount: number;
  impactedCorridors: CorridorImpactDiff[];
  selectedTraceDiff: CorridorImpactDiff | null;
}

const VALID_CABLE_IDS = new Set(SUBSEA_CABLES.map((c) => c.id));
const VALID_STATION_IDS = new Set(LANDING_STATIONS.map((s) => s.id));
const VALID_SCENARIO_IDS = new Set(SCENARIO_PRESETS.map((p) => p.id));

function encodeBase64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(token: string): string {
  const padded = token.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const bin = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function serializeSimulatorState(params: {
  snapshot: NetworkSnapshot;
  activeScenarioId: string | null;
  srcId: string;
  dstId: string;
  inspectedCableId: string;
  viewMode: 'split' | 'subsea' | 'globe';
  density: 'engineering' | 'simplified';
  highContrast: boolean;
}): string {
  const faults: SerializedFaultItem[] = [];
  for (const [id, st] of params.snapshot.cables) {
    if (st.cutState !== 'active' || st.subsystemFaultMode !== 'none') {
      faults.push({
        id,
        t: Number(st.cutProgressT.toFixed(2)),
        cause: st.faultCause ?? undefined,
        mode:
          st.subsystemFaultMode !== 'none' ? st.subsystemFaultMode : undefined,
        repair: st.cutState === 'repairing' ? true : undefined,
      });
    }
  }

  const bgp = params.snapshot.bgpConfig;
  const bgpCompact: SerializedScenarioState['bgp'] =
    bgp.enforceStrictCapeNoExport ||
    bgp.routeLeakActive ||
    bgp.prefixHijackActive ||
    bgp.transitAsOutage ||
    bgp.disabledStations?.size
      ? {
          ne: bgp.enforceStrictCapeNoExport || undefined,
          rl: bgp.routeLeakActive || undefined,
          ph: bgp.prefixHijackActive || undefined,
          to: bgp.transitAsOutage || undefined,
          ds: bgp.disabledStations?.size
            ? Array.from(bgp.disabledStations)
            : undefined,
        }
      : undefined;

  const payload: SerializedScenarioState = {
    v: 1,
    sc: params.activeScenarioId || undefined,
    src: params.srcId,
    dst: params.dstId,
    ins: params.inspectedCableId,
    vm: params.viewMode !== 'split' ? params.viewMode : undefined,
    dn: params.density !== 'engineering' ? params.density : undefined,
    hc: params.highContrast || undefined,
    f: faults.length > 0 ? faults : undefined,
    bgp: bgpCompact,
  };

  return `#s=${encodeBase64Url(JSON.stringify(payload))}`;
}

export function parseSimulatorHash(hash: string): SerializedScenarioState | null {
  if (!hash || !hash.startsWith('#s=')) return null;
  try {
    const token = hash.slice(3).trim();
    if (!token || token.length > 4096) return null;
    const raw = JSON.parse(decodeBase64Url(token)) as Partial<SerializedScenarioState>;
    if (!raw || raw.v !== 1) return null;

    const clean: SerializedScenarioState = {
      v: 1,
      sc: raw.sc && VALID_SCENARIO_IDS.has(raw.sc) ? raw.sc : undefined,
      src: raw.src && VALID_STATION_IDS.has(raw.src) ? raw.src : undefined,
      dst: raw.dst && VALID_STATION_IDS.has(raw.dst) ? raw.dst : undefined,
      ins: raw.ins && VALID_CABLE_IDS.has(raw.ins) ? raw.ins : undefined,
      vm:
        raw.vm === 'split' || raw.vm === 'subsea' || raw.vm === 'globe'
          ? raw.vm
          : undefined,
      dn:
        raw.dn === 'engineering' || raw.dn === 'simplified'
          ? raw.dn
          : undefined,
      hc: typeof raw.hc === 'boolean' ? raw.hc : undefined,
      f: Array.isArray(raw.f)
        ? raw.f.filter((item) => item && VALID_CABLE_IDS.has(item.id))
        : undefined,
      bgp: raw.bgp
        ? {
            ne: Boolean(raw.bgp.ne),
            rl: Boolean(raw.bgp.rl),
            ph: Boolean(raw.bgp.ph),
            to: Boolean(raw.bgp.to),
            ds: Array.isArray(raw.bgp.ds)
              ? raw.bgp.ds.filter((id) => VALID_STATION_IDS.has(id))
              : undefined,
          }
        : undefined,
    };
    return clean;
  } catch {
    return null;
  }
}

export function hydrateEngineFromState(
  engine: RoutingEngine,
  parsed: SerializedScenarioState
): void {
  engine.restoreAll();

  const bgpCfg: BgpControlPlaneConfig = {};
  if (parsed.bgp?.ne) bgpCfg.enforceStrictCapeNoExport = true;
  if (parsed.bgp?.rl) bgpCfg.routeLeakActive = true;
  if (parsed.bgp?.ph) bgpCfg.prefixHijackActive = true;
  if (parsed.bgp?.to) bgpCfg.transitAsOutage = true;
  if (parsed.bgp?.ds?.length) bgpCfg.disabledStations = new Set(parsed.bgp.ds);

  if (parsed.sc) {
    const preset = SCENARIO_PRESETS.find((p) => p.id === parsed.sc);
    if (preset && (!parsed.f || parsed.f.length === 0)) {
      engine.applyScenario(
        preset.cableIdsToCut,
        preset.name,
        preset.cause,
        preset.subsystemFaultMode,
        preset.bgpConfig ?? bgpCfg
      );
    } else {
      engine.setBgpConfig(bgpCfg);
    }
  } else {
    engine.setBgpConfig(bgpCfg);
  }

  if (parsed.f && parsed.f.length > 0) {
    for (const item of parsed.f) {
      const t = Number.isFinite(item.t) ? Math.min(1, Math.max(0, item.t)) : 0.5;
      engine.severCable(item.id, undefined, t, item.cause, item.mode);
      if (item.repair) {
        engine.dispatchRepairShip(item.id);
      }
    }
  }

  if (parsed.src && parsed.dst && parsed.src !== parsed.dst) {
    engine.setCustomTraceEndpoints(parsed.src, parsed.dst);
  }
}

function buildCorridorDiff(corridor: TrafficCorridor): CorridorImpactDiff {
  const pathChanged =
    corridor.currentCables.length !== corridor.baselineCables.length ||
    corridor.currentCables.some((id, idx) => id !== corridor.baselineCables[idx]);

  const afterRttMs = corridor.currentRttMs;
  const rttDeltaMs = Number.isFinite(afterRttMs)
    ? Number((afterRttMs - corridor.baselineRttMs).toFixed(1))
    : Infinity;

  return {
    id: corridor.id,
    label: corridor.label,
    status: corridor.status,
    beforeRttMs: corridor.baselineRttMs,
    afterRttMs,
    rttDeltaMs,
    beforePath: corridor.baselinePath,
    afterPath: corridor.currentPath,
    beforeCables: corridor.baselineCables,
    afterCables: corridor.currentCables,
    pathChanged,
  };
}

export function computeImpactComparison(
  baseline: NetworkSnapshot,
  current: NetworkSnapshot
): ImpactComparisonReport {
  const activeTbpsBefore = baseline.totalActiveTbps;
  const activeTbpsAfter = current.totalActiveTbps;
  const capacityDeltaTbps = Number((activeTbpsAfter - activeTbpsBefore).toFixed(1));
  const capacityDeltaPct =
    activeTbpsBefore > 0
      ? Number(((capacityDeltaTbps / activeTbpsBefore) * 100).toFixed(1))
      : 0;

  const meanRttBefore = baseline.meanGlobalRttMs;
  const meanRttAfter = current.meanGlobalRttMs;
  const meanRttDeltaMs = Number((meanRttAfter - meanRttBefore).toFixed(1));

  const faultedTrunksCount =
    current.severedCount + current.degradedCount + current.repairingCount;

  const impactedCorridors: CorridorImpactDiff[] = [];
  for (const corridor of current.corridors) {
    if (corridor.status !== 'OPTIMAL') {
      impactedCorridors.push(buildCorridorDiff(corridor));
    }
  }

  const impactedFlowsCount = impactedCorridors.length;

  let selectedTraceDiff: CorridorImpactDiff | null = null;
  if (current.customTrace) {
    const baseMatch = baseline.corridors.find(
      (c) =>
        c.srcId === current.customTrace!.srcId &&
        c.dstId === current.customTrace!.dstId
    );
    if (baseMatch) {
      selectedTraceDiff = buildCorridorDiff({
        ...current.customTrace,
        baselinePath: baseMatch.baselinePath,
        baselineCables: baseMatch.baselineCables,
        baselineRttMs: baseMatch.baselineRttMs,
      });
    } else {
      selectedTraceDiff = buildCorridorDiff(current.customTrace);
    }
  }

  const hasBgpAnomaly = Boolean(
    current.bgpConfig.routeLeakActive ||
      current.bgpConfig.prefixHijackActive ||
      current.bgpConfig.enforceStrictCapeNoExport ||
      current.bgpConfig.transitAsOutage ||
      current.bgpConfig.disabledStations?.size
  );

  const hasChanges =
    faultedTrunksCount > 0 ||
    impactedCorridors.length > 0 ||
    capacityDeltaTbps !== 0 ||
    hasBgpAnomaly;

  return {
    hasChanges,
    activeTbpsBefore,
    activeTbpsAfter,
    capacityDeltaTbps,
    capacityDeltaPct,
    meanRttBefore,
    meanRttAfter,
    meanRttDeltaMs,
    faultedTrunksCount,
    impactedFlowsCount,
    impactedCorridors,
    selectedTraceDiff,
  };
}
