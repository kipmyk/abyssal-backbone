import type { CableProvenanceRecord, SeabedEngineeringSample } from '../data/provenance';
import type { BgpControlPlaneConfig, BgpRouteAdvertisement } from '../sim/bgpEngine';
import type { OpticalPerformanceMetrics } from '../sim/opticalEngine';
import type { OtdrLocalizationReport } from '../sim/otdrEngine';
import type { PfeTelemetry, SubsystemFaultMode } from '../sim/pfeEngine';
import type { SubseaRepairPlan } from '../sim/repairEngine';

export type CableCutState = 'active' | 'degraded' | 'severed' | 'repairing';

export type FaultCause =
  | 'Anchor Drag'
  | 'Turbidity Landslide'
  | 'Trawler Snag'
  | 'PFE Shunt Fault'
  | 'Seismic Earthquake'
  | 'Branching Unit Fault'
  | 'Repeater Pump Failure'
  | 'Shore PFE Terminal Outage';

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
  subsystemFaultMode: SubsystemFaultMode;
  cutCoord: [number, number] | null;
  cutProgressT: number; // 0..1 along cable polyline
  faultCause: FaultCause | null;
  faultDistanceKm: number | null;
  faultUncertaintyKm: number | null;
  faultDepthM: number | null;
  repairProgress: number; // 0..1 when repairing
  repairPhase: RepairPhase | null;
  repairShip: string | null;
  utilization: number; // 0..2.0 (1.0 = 100% capacity)
  carriedTbps: number;
  effectiveLatencyMs: number;
  baseLatencyMs: number;
  pfeVoltageKv: number; // ±kV power feeding equipment
  repeaterCount: number; // EDFA optical repeaters
  osnrDb: number; // Generalized SNR / OSNR (dB)
  optical: OpticalPerformanceMetrics;
  pfe: PfeTelemetry;
  otdr: OtdrLocalizationReport;
  seabedSample: SeabedEngineeringSample;
  provenance: CableProvenanceRecord;
  repairPlan: SubseaRepairPlan | null;
}

export type CorridorStatus =
  | 'OPTIMAL'
  | 'REROUTED'
  | 'CONGESTED'
  | 'POLICY_BLOCKED'
  | 'HIJACKED'
  | 'PARTITIONED';

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
  bgpRoute: BgpRouteAdvertisement | null;
  physicallyReachable: boolean;
}

export type EventSubsystem = 'Optical' | 'BGP' | 'PFE' | 'Repair' | 'System';

export interface NetworkEvent {
  id: string;
  timestamp: string;
  relativeTime: string;
  subsystem: EventSubsystem;
  severity: 'critical' | 'warning' | 'info' | 'recovery';
  code: string;
  message: string;
}

export interface HistoricalEventContext {
  date: string;
  factualSummary: string;
  impactHighlight: string;
  sourceNote: string;
}

export interface ScenarioPreset {
  id: string;
  name: string;
  subtitle: string;
  category: 'Physical Cut' | 'Power & Wet Plant' | 'BGP Control Plane' | 'Facility Outage';
  cableIdsToCut: string[];
  focusLatLon: [number, number];
  suggestedCorridorId: string;
  cause?: FaultCause;
  subsystemFaultMode?: SubsystemFaultMode;
  bgpConfig?: BgpControlPlaneConfig;
  historicalEvent?: HistoricalEventContext;
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
  degradedCount: number;
  repairingCount: number;
  reroutedCount: number;
  partitionedCount: number;
  bgpConfig: BgpControlPlaneConfig;
}
