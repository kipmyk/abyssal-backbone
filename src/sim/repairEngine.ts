import { sampleCableEngineeringAtPoint } from '../data/provenance';
import type { RepairPhase, SubseaCable } from '../types/network';

/**
 * Subsea Cable Installation & Marine Repair Operations Engine
 *
 * Implements the 15-stage maritime repair workflow governed by:
 * - Water depth at fault coordinate (m)
 * - Cable burial depth & sediment class (m)
 * - Cable armor class (DA / SA / LWP / LW)
 * - Depot transit distance (km / nautical miles) & vessel transit speed (knots)
 * - Beaufort sea state & wave height limits for DP2 station keeping and deck jointing
 * - Required spare cable bight insertion length (approx. 2.2x water depth)
 */

export interface CableShipSpec {
  name: string;
  operator: string;
  depotCity: string;
  depotLat: number;
  depotLon: number;
  zone: string;
  transitSpeedKnots: number;
  maxRovDepthM: number;
  universalJointingBays: number;
  dpClass: 'DP2' | 'DP3';
}

export const CABLE_REPAIR_FLEET: CableShipSpec[] = [
  {
    name: 'CS Leon Thevenin',
    operator: 'Orange Marine (IOCMA)',
    depotCity: 'Cape Town',
    depotLat: -33.9,
    depotLon: 18.42,
    zone: 'IOCMA (Indian Ocean)',
    transitSpeedKnots: 13.5,
    maxRovDepthM: 3000,
    universalJointingBays: 2,
    dpClass: 'DP2',
  },
  {
    name: 'CS Responder',
    operator: 'Elettra / SubCom (MECMA)',
    depotCity: 'Catania',
    depotLat: 37.5,
    depotLon: 15.09,
    zone: 'MECMA (Med/Red Sea)',
    transitSpeedKnots: 14.0,
    maxRovDepthM: 2500,
    universalJointingBays: 2,
    dpClass: 'DP2',
  },
  {
    name: 'CS Pierre de Fermat',
    operator: 'Orange Marine (ACMA)',
    depotCity: 'Brest',
    depotLat: 48.38,
    depotLon: -4.49,
    zone: 'ACMA (Atlantic)',
    transitSpeedKnots: 14.5,
    maxRovDepthM: 3500,
    universalJointingBays: 2,
    dpClass: 'DP3',
  },
  {
    name: 'CS Reliance',
    operator: 'SubCom (SEAIOCMA)',
    depotCity: 'Singapore',
    depotLat: 1.26,
    depotLon: 103.82,
    zone: 'PIOCMA (Pacific)',
    transitSpeedKnots: 13.8,
    maxRovDepthM: 4000,
    universalJointingBays: 2,
    dpClass: 'DP2',
  },
  {
    name: 'CS Cable Innovator',
    operator: 'Global Marine (PIOCMA)',
    depotCity: 'Yokohama',
    depotLat: 35.44,
    depotLon: 139.64,
    zone: 'PIOCMA (Pacific)',
    transitSpeedKnots: 13.2,
    maxRovDepthM: 3000,
    universalJointingBays: 2,
    dpClass: 'DP2',
  },
];

export interface RepairWorkflowStep {
  stepNumber: number;
  code: string;
  label: string;
  durationHours: number;
  cumulativeHours: number;
  legacyPhase: RepairPhase;
  engineeringDetail: string;
}

export interface SubseaRepairPlan {
  vessel: CableShipSpec;
  transitDistanceNm: number;
  waterDepthM: number;
  burialDepthM: number;
  seaStateBeaufort: number;
  significantWaveHeightM: number;
  recoveryMethod: 'ROV Jet-Detrench & Cut' | 'Flatfish / Lucas Holding Grapnel' | 'Rennie Cut-and-Hold Deep Grapnel';
  spareCableInsertedKm: number;
  universalJointCount: number;
  totalEstimatedHours: number;
  currentStepIndex: number; // 0..14
  currentStep: RepairWorkflowStep;
  elapsedHours: number;
  remainingHours: number;
  steps: RepairWorkflowStep[];
}

function haversineNauticalMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R_KM = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R_KM * c;
  return Math.round(km * 0.539957);
}

/**
 * Selects the nearest qualified cable ship from the maintenance zone fleet
 * and calculates a physically grounded 15-stage repair plan.
 */
export function computeSubseaRepairPlan(
  cable: SubseaCable,
  faultCoord: [number, number],
  repairProgress01: number
): SubseaRepairPlan {
  const [fLat, fLon] = faultCoord;
  const eng = sampleCableEngineeringAtPoint(cable, fLat, fLon);
  const absDepthM = Math.max(15, Math.abs(eng.depthM));

  // Select nearest cable ship by nautical miles
  let bestShip = CABLE_REPAIR_FLEET[0];
  let minNm = Infinity;
  for (const ship of CABLE_REPAIR_FLEET) {
    const nm = haversineNauticalMiles(fLat, fLon, ship.depotLat, ship.depotLon);
    if (nm < minNm) {
      minNm = nm;
      bestShip = ship;
    }
  }
  const transitDistanceNm = Math.max(45, minNm);

  // Deterministic sea state from latitude & longitude (Roaring Forties / North Atlantic / Typhoon belt higher sea state)
  const absLat = Math.abs(fLat);
  const seaStateBeaufort =
    absLat > 36 ? 5 : absLat > 20 ? 4 : 3;
  const significantWaveHeightM = Number(
    (seaStateBeaufort === 5 ? 2.6 : seaStateBeaufort === 4 ? 1.8 : 1.1).toFixed(1)
  );
  const weatherFactor = 1 + (seaStateBeaufort - 2) * 0.14;

  // Determine recovery method by water depth and burial depth
  const recoveryMethod: SubseaRepairPlan['recoveryMethod'] =
    eng.actualBurialDepthM >= 0.4 && absDepthM <= 1800
      ? 'ROV Jet-Detrench & Cut'
      : absDepthM <= 2500
      ? 'Flatfish / Lucas Holding Grapnel'
      : 'Rennie Cut-and-Hold Deep Grapnel';

  // Spare cable required for a bight recovery equals ~2.2x water depth + water-ingress cutback (1.2 km)
  const spareCableInsertedKm = Number(
    ((absDepthM * 2.2) / 1000 + 1.2).toFixed(2)
  );
  const universalJointCount = 2; // Initial end joint + final bight splice

  const transitHours = Math.round(
    (transitDistanceNm / bestShip.transitSpeedKnots) * weatherFactor
  );
  const grappleHours = Math.round(
    (4 + (absDepthM / 1000) * 3.8 + eng.actualBurialDepthM * 4.5) * weatherFactor
  );
  const recoveryHours = Math.round(
    (3 + (absDepthM / 1000) * 2.6) * weatherFactor
  );
  const jointingHours = Math.round(18 * universalJointCount); // ~18h per Universal Joint (UJ)
  const relayBurialHours = Math.round(
    4 + (absDepthM / 1000) * 2.0 + eng.actualBurialDepthM * 6.0
  );

  const rawSteps: Array<{
    code: string;
    label: string;
    hours: number;
    legacyPhase: RepairPhase;
    detail: string;
  }> = [
    {
      code: '01-NOTIFY',
      label: 'Fault Notification & NOC Alarm',
      hours: 1,
      legacyPhase: 'steaming',
      detail: 'CLS PFE trip & SD-FEC Loss-of-Signal alarm raised to consortium NOC.',
    },
    {
      code: '02-LOCALIZE',
      label: 'C-OTDR & PFE Bridge Localization',
      hours: 3,
      legacyPhase: 'steaming',
      detail: 'Bi-directional C-OTDR & LME repeater telemetry isolate fault span.',
    },
    {
      code: '03-PLAN',
      label: 'Repair Engineering & Maritime Permits',
      hours: 6,
      legacyPhase: 'steaming',
      detail: `Selected ${eng.armorClass} spare cable (${spareCableInsertedKm} km) & issued Notice to Mariners.`,
    },
    {
      code: '04-MOBILIZE',
      label: 'Vessel Mobilization & Spare Loading',
      hours: 18,
      legacyPhase: 'steaming',
      detail: `${bestShip.name} mobilized at ${bestShip.depotCity} depot; loaded UJ kits.`,
    },
    {
      code: '05-TRANSIT',
      label: `Transit to Fault Ground (${transitDistanceNm} NM)`,
      hours: transitHours,
      legacyPhase: 'steaming',
      detail: `Steaming at ${bestShip.transitSpeedKnots} kn through Beaufort ${seaStateBeaufort} (${significantWaveHeightM}m swell).`,
    },
    {
      code: '06-DP-STATION',
      label: 'DP2 Station Keeping & Acoustic Beacon Drop',
      hours: 4,
      legacyPhase: 'grappling',
      detail: `Established ${bestShip.dpClass} dynamic positioning over ${absDepthM}m contour.`,
    },
    {
      code: '07-GRAPNEL-ROV',
      label: `${recoveryMethod}`,
      hours: grappleHours,
      legacyPhase: 'grappling',
      detail: `Operating at ${absDepthM}m seabed (${eng.sediment}, ${eng.actualBurialDepthM}m burial).`,
    },
    {
      code: '08-RECOVERY',
      label: 'Cable Ends Recovered to Bow Sheaves',
      hours: recoveryHours,
      legacyPhase: 'grappling',
      detail: 'Winched first cable end aboard; buoyed off second end on surface.',
    },
    {
      code: '09-CUTBACK',
      label: 'Water-Ingress Cutback & Dark Fiber Check',
      hours: 4,
      legacyPhase: 'splicing',
      detail: 'Cut back 600m of seawater-penetrated core; verified dry insulation.',
    },
    {
      code: '10-JOINTING',
      label: `Shipboard Cleanroom Universal Jointing (2x UJ)`,
      hours: jointingHours,
      legacyPhase: 'splicing',
      detail: `Fusion-splicing fiber pairs, swaging copper PFE sleeve, X-ray polyethylene moulding.`,
    },
    {
      code: '11-ELEC-TEST',
      label: 'HVDC Insulation & Conductor Continuity Test',
      hours: 3,
      legacyPhase: 'splicing',
      detail: 'Megger 10 kV DC insulation resistance test against ocean earth return.',
    },
    {
      code: '12-OPT-TEST',
      label: 'Bi-Directional C-OTDR Splice Acceptance',
      hours: 3,
      legacyPhase: 'splicing',
      detail: 'Verified UJ splice insertion loss < 0.08 dB across all fiber pairs.',
    },
    {
      code: '13-RELAY-BURY',
      label: 'Final Bight Lay & Post-Repair ROV Burial',
      hours: relayBurialHours,
      legacyPhase: 'pfe-ramp',
      detail: `Laid ${spareCableInsertedKm} km replacement bight onto ${absDepthM}m seabed.`,
    },
    {
      code: '14-PFE-RAMP',
      label: 'PFE Constant-Current Ramp & EDFA Turn-Up',
      hours: 2,
      legacyPhase: 'pfe-ramp',
      detail: 'Ramped shore PFE rectifiers to nominal line current; verified EDFA pump bias.',
    },
    {
      code: '15-BGP-VERIFY',
      label: 'Bit-Error Soak & BGP Session Restoration',
      hours: 2,
      legacyPhase: 'pfe-ramp',
      detail: 'Post-FEC BER < 1e-12 confirmed; eBGP timers cleared and traffic restored.',
    },
  ];

  let cum = 0;
  const steps: RepairWorkflowStep[] = rawSteps.map((s, idx) => {
    cum += s.hours;
    return {
      stepNumber: idx + 1,
      code: s.code,
      label: s.label,
      durationHours: s.hours,
      cumulativeHours: cum,
      legacyPhase: s.legacyPhase,
      engineeringDetail: s.detail,
    };
  });

  const totalEstimatedHours = cum;
  const clampedProg = Math.max(0, Math.min(1, repairProgress01));
  const elapsedHours = Number((clampedProg * totalEstimatedHours).toFixed(1));
  const remainingHours = Number(
    Math.max(0, totalEstimatedHours - elapsedHours).toFixed(1)
  );

  let currentStepIndex = steps.findIndex(
    (s) => elapsedHours <= s.cumulativeHours
  );
  if (currentStepIndex === -1) currentStepIndex = steps.length - 1;

  return {
    vessel: bestShip,
    transitDistanceNm,
    waterDepthM: absDepthM,
    burialDepthM: eng.actualBurialDepthM,
    seaStateBeaufort,
    significantWaveHeightM,
    recoveryMethod,
    spareCableInsertedKm,
    universalJointCount,
    totalEstimatedHours,
    currentStepIndex,
    currentStep: steps[currentStepIndex],
    elapsedHours,
    remainingHours,
    steps,
  };
}

