import { LANDING_STATIONS } from '../data/networkData';
import type { QualityModeSetting, RenderQualityTier } from '../globe/GlobeScene';
import type { RoutingEngine } from '../sim/routingEngine';
import type {
  EventSubsystem,
  LandingStation,
  NetworkSnapshot,
  TrafficCorridor,
} from '../types/network';

export type ViewMode = 'split' | 'subsea' | 'globe';
export type DensityMode = 'simplified' | 'engineering';
export type ClickMode = 'inspect' | 'fault';
export type EventFilterMode = 'All' | EventSubsystem;

export interface StoreEventMap {
  snapshot: NetworkSnapshot;
  repairTick: NetworkSnapshot;
  selection: void;
  eventsFilter: EventFilterMode;
  ui: void;
}

type Listener<T> = (payload: T) => void;

/**
 * Minimal typed pub/sub emitter decoupling simulation state changes from UI panels.
 */
export class TypedEventEmitter<TMap extends object> {
  private listeners = new Map<keyof TMap, Set<Listener<never>>>();

  on<K extends keyof TMap>(event: K, listener: Listener<TMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  off<K extends keyof TMap>(event: K, listener: Listener<TMap[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof TMap>(event: K, payload: TMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of set) {
      (listener as Listener<TMap[K]>)(payload);
    }
  }
}

/**
 * Central reactive application state container coordinating RoutingEngine snapshots,
 * operator selection state, and viewport/accessibility preferences.
 */
export class SimulatorStore extends TypedEventEmitter<StoreEventMap> {
  readonly engine: RoutingEngine;
  readonly stationById: Map<string, LandingStation>;
  readonly baselineSnapshot: NetworkSnapshot;

  currentSnapshot: NetworkSnapshot;
  activeScenarioId: string | null = null;
  selectedCorridorId = 'mba-mrs';
  inspectedCableId = 'aae1-redsea';
  traceSrcId = 'mombasa';
  traceDstId = 'marseille';
  nextStationTarget: 'src' | 'dst' = 'dst';

  motionPaused = false;
  clickMode: ClickMode = 'inspect';
  densityMode: DensityMode = 'engineering';
  highContrastMode = false;
  focusMode = false;
  viewMode: ViewMode = 'split';
  activeEventFilter: EventFilterMode = 'All';
  activeQualityMode: QualityModeSetting = 'auto';
  activeQualityTier: RenderQualityTier = 'balanced';
  repairTickAccumulator = 0;

  constructor(engine: RoutingEngine) {
    super();
    this.engine = engine;
    this.stationById = new Map(LANDING_STATIONS.map((s) => [s.id, s]));
    this.engine.setCustomTraceEndpoints(this.traceSrcId, this.traceDstId);
    this.baselineSnapshot = this.engine.computeSnapshot();
    this.currentSnapshot = this.baselineSnapshot;
  }

  getHighlightedTrace(): TrafficCorridor | null {
    if (this.selectedCorridorId === 'custom-trace') {
      return this.currentSnapshot.customTrace;
    }
    return (
      this.currentSnapshot.corridors.find(
        (c) => c.id === this.selectedCorridorId
      ) ?? this.currentSnapshot.customTrace
    );
  }

  refreshSnapshot(mode: 'full' | 'repairTick' = 'full'): void {
    this.currentSnapshot = this.engine.computeSnapshot();
    if (mode === 'repairTick') {
      this.emit('repairTick', this.currentSnapshot);
    } else {
      this.emit('snapshot', this.currentSnapshot);
    }
  }

  setInspectedCable(cableId: string, emitSelection = true): void {
    this.inspectedCableId = cableId;
    if (emitSelection) {
      this.emit('selection', undefined);
    }
  }

  setTraceEndpoints(
    srcId: string,
    dstId: string,
    corridorId = 'custom-trace',
    emitSnapshot = true
  ): void {
    this.traceSrcId = srcId;
    this.traceDstId = dstId;
    this.selectedCorridorId = corridorId;
    this.engine.setCustomTraceEndpoints(srcId, dstId);
    if (emitSnapshot) {
      this.refreshSnapshot('full');
      this.emit('selection', undefined);
    }
  }

  setEventFilter(filter: EventFilterMode): void {
    this.activeEventFilter = filter;
    this.emit('eventsFilter', filter);
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    this.emit('ui', undefined);
  }

  setDensityMode(mode: DensityMode): void {
    this.densityMode = mode;
    this.emit('ui', undefined);
  }

  setContrastTheme(enabled: boolean): void {
    this.highContrastMode = enabled;
    this.emit('ui', undefined);
  }

  setFocusMode(enabled: boolean): void {
    this.focusMode = enabled;
    this.emit('ui', undefined);
  }

  setClickMode(mode: ClickMode): void {
    this.clickMode = mode;
    this.emit('ui', undefined);
  }

  setQualityMode(mode: QualityModeSetting): void {
    this.activeQualityMode = mode;
    this.emit('ui', undefined);
  }

  setActiveQualityTier(tier: RenderQualityTier): void {
    this.activeQualityTier = tier;
    this.emit('ui', undefined);
  }

  setMotionPaused(paused: boolean): void {
    this.motionPaused = paused;
    this.emit('ui', undefined);
  }
}
