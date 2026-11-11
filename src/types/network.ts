export type CableCutState = 'active' | 'severed' | 'repairing';

export type FaultCause =
  | 'Anchor Drag'
  | 'Turbidity Landslide'
  | 'Trawler Snag'
  | 'PFE Shunt Fault';

export type RepairPhase = 'steaming' | 'grappling' | 'splicing' | 'pfe-ramp';

export interface LandingStation {
  id: string;
  name: string;
  city: string;
  country: string;
  region: 'Africa' | 'Europe' | 'Middle East' | 'Asia-Pacific' | 'Americas';
  lat: number;
  lon: number;
  tier: 1 | 2;
  ixps: string[];
  powerMW: number;
}

export interface SubseaCable {
  id: string;
  name: string;
  systemCode: string;
  capacityTbps: number;
  lengthKm: number;
  rfsYear: number;
  owners: string;
  depthMaxM: number;
  corridorTag: string;
  isTerrestrial?: boolean;
  endpoints: [string, string];
  waypoints: [number, number][]; // [lat, lon]
}

export interface CableRuntimeState {
  id: string;
  cutState: CableCutState;
  cutCoord: [number, number] | null;
  cutProgressT: number; // 0..1 along cable polyline
  faultCause: FaultCause | null;
  faultDistanceKm: number | null;
  faultDepthM: number | null;
  repairProgress: number; // 0..1 when repairing
  repairPhase: RepairPhase | null;
  repairShip: string | null;
  utilization: number; // 0..2.0 (1.0 = 100% capacity)
  carriedTbps: number;
  effectiveLatencyMs: number;
  baseLatencyMs: number;
  pfeVoltageKv: number; // ±kV power feeding equipment
  repeaterCount: number; // EDFA optical repeaters spaced ~95 km
  osnrDb: number; // Optical Signal-to-Noise Ratio
}

export type CorridorStatus = 'OPTIMAL' | 'REROUTED' | 'CONGESTED' | 'PARTITIONED';

export interface TrafficCorridor {
  id: string;
  label: string;
  srcId: string;
  dstId: string;
  demandTbps: number;
  baselinePath: string[]; // station IDs
  baselineCables: string[]; // cable IDs
  baselineRttMs: number;
  currentPath: string[];
  currentCables: string[];
  currentRttMs: number;
  hops: number;
  status: CorridorStatus;
  bottleneckUtilization: number;
  packetLossPct: number;
  jitterMs: number;
}

export interface NetworkEvent {
  id: string;
  timestamp: string;
  severity: 'critical' | 'warning' | 'info' | 'recovery';
  code: string;
  message: string;
}

export interface ScenarioPreset {
  id: string;
  name: string;
  subtitle: string;
  cableIdsToCut: string[];
  focusLatLon: [number, number];
  suggestedCorridorId: string;
  cause?: FaultCause;
}

export interface NetworkSnapshot {
  cables: Map<string, CableRuntimeState>;
  corridors: TrafficCorridor[];
  customTrace: TrafficCorridor | null;
  totalActiveTbps: number;
  totalDesignTbps: number;
  meanGlobalRttMs: number;
  baselineMeanRttMs: number;
  severedCount: number;
  repairingCount: number;
  reroutedCount: number;
  partitionedCount: number;
}
