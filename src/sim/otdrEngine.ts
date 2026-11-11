import { deriveOpticalSpec } from './opticalEngine';
import type { SubsystemFaultMode } from './pfeEngine';
import type { SubseaCable } from '../types/network';

/**
 * Coherent OTDR (C-OTDR), Line Monitoring Equipment (LME), and PFE Bridge
 * Fault Localization Engine (ITU-T G.976 & G.977.1).
 *
 * Physical Principles Modeled:
 * 1. Standard shore-based OTDR pulses cannot pass backward through unidirectional
 *    EDFA optical isolators; conventional OTDR range is limited to the first
 *    repeater span (~70-90 km).
 * 2. Submarine systems localize trunk faults beyond the 1st repeater using:
 *    - Coherent OTDR (C-OTDR) routed via high-loss passive supervisory return
 *      couplers across each repeater stage.
 *    - Line Monitoring Equipment (LME) per-repeater optical power & gain telemetry.
 *    - PFE DC Resistance Bridge (Ohm/km) and Low-Frequency Capacitance Bridge
 *      when the copper conductor is shunted or severed.
 * 3. Every localization measurement carries non-zero distance uncertainty (±km)
 *    governed by fiber group index variance (Δn_g), laying slack (1.5-4.5%),
 *    pulse width dead zones, and ASE noise floor.
 */

export type LocalizationInstrumentMode =
  | 'C-OTDR + LME Supervisory'
  | 'PFE DC Resistance/Capacitance Bridge'
  | 'Shore-End Conventional OTDR';

export interface OtdrTraceSample {
  km: number;
  levelDb: number;
  spanIndex: number;
  eventTag?: 'REPEATER' | 'SPLICE' | 'FAULT-FRESNEL' | 'NOISE-FLOOR';
}

export interface OtdrLocalizationReport {
  instrumentMode: LocalizationInstrumentMode;
  wavelengthNm: number;
  pulseWidthNs: number;
  dynamicRangeDb: number;
  eventDeadZoneM: number;
  attenuationDeadZoneM: number;
  fiberAttenuationDbKm: number;
  repeaterSpacingKm: number;
  trueFaultDistanceKm: number | null;
  estimatedFaultDistanceKm: number | null;
  uncertaintyPlusMinusKm: number | null;
  confidencePct: number | null;
  faultSpanIndex: number | null;
  fresnelReflectionDb: number | null;
  localizationNotes: string;
  traceSamples: OtdrTraceSample[];
}

/**
 * Deterministic pseudo-noise generator keyed by cable ID and sample index
 * so traces are reproducible under fixed state.
 */
function deterministicHash(seedStr: string, idx: number): number {
  let h = 2166136261 ^ idx;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000 - 0.5; // -0.5 .. +0.5
}

export function computeOtdrAnalysis(
  cable: SubseaCable,
  repeaterCount: number,
  faultMode: SubsystemFaultMode,
  faultProgressT: number
): OtdrLocalizationReport {
  const optSpec = deriveOpticalSpec(cable);
  const spanCount = Math.max(1, repeaterCount + 1);
  const repeaterSpacingKm = Number((cable.lengthKm / spanCount).toFixed(2));
  const hasOpticalBreak =
    faultMode === 'complete-cut' || faultMode === 'optical-only-cut';
  const hasElectricalFault =
    faultMode === 'complete-cut' || faultMode === 'shunt-fault';

  const trueFaultDistanceKm =
    faultMode !== 'none'
      ? Number((cable.lengthKm * Math.max(0.02, Math.min(0.98, faultProgressT))).toFixed(2))
      : null;

  // Select appropriate submarine localization instrument
  let instrumentMode: LocalizationInstrumentMode = 'C-OTDR + LME Supervisory';
  if (trueFaultDistanceKm !== null && trueFaultDistanceKm <= repeaterSpacingKm) {
    instrumentMode = 'Shore-End Conventional OTDR';
  } else if (faultMode === 'shunt-fault') {
    instrumentMode = 'PFE DC Resistance/Capacitance Bridge';
  }

  // Pulse width & dead zones depend on instrument mode
  const pulseWidthNs =
    instrumentMode === 'Shore-End Conventional OTDR' ? 100 : 1000;
  const eventDeadZoneM =
    instrumentMode === 'Shore-End Conventional OTDR' ? 12 : 120;
  const attenuationDeadZoneM =
    instrumentMode === 'Shore-End Conventional OTDR' ? 45 : 380;
  const dynamicRangeDb =
    instrumentMode === 'Shore-End Conventional OTDR' ? 42.0 : 28.5;

  // Compute realistic measurement uncertainty (±km) and deterministic offset
  let estimatedFaultDistanceKm: number | null = null;
  let uncertaintyPlusMinusKm: number | null = null;
  let confidencePct: number | null = null;
  let faultSpanIndex: number | null = null;
  let fresnelReflectionDb: number | null = null;
  let localizationNotes =
    'All repeater spans nominal. C-OTDR sawtooth gain restoration verified across full trunk.';

  if (trueFaultDistanceKm !== null) {
    faultSpanIndex = Math.min(
      spanCount,
      Math.floor(trueFaultDistanceKm / repeaterSpacingKm) + 1
    );

    if (instrumentMode === 'Shore-End Conventional OTDR') {
      // High accuracy within 1st span: group index uncertainty ~0.04% + slack uncertainty
      uncertaintyPlusMinusKm = Number(
        Math.max(0.12, trueFaultDistanceKm * 0.004).toFixed(2)
      );
      confidencePct = 99.1;
    } else if (instrumentMode === 'C-OTDR + LME Supervisory') {
      // C-OTDR resolves exact repeater span via LME, then measures distance from upstream repeater
      // Uncertainty governed by within-span slack (2.5%) and ASE noise floor (~±0.6 to ±2.4 km)
      const distIntoSpan = trueFaultDistanceKm % repeaterSpacingKm;
      uncertaintyPlusMinusKm = Number(
        (0.45 + distIntoSpan * 0.018 + Math.log10(spanCount) * 0.35).toFixed(2)
      );
      confidencePct = 96.8;
    } else {
      // PFE DC Resistance Bridge (R = R_c * x): affected by seawater earth return & temperature gradient (~±2.2 to ±6.5 km)
      uncertaintyPlusMinusKm = Number(
        (1.8 + trueFaultDistanceKm * 0.0012).toFixed(2)
      );
      confidencePct = 91.5;
    }

    // Apply a small deterministic measurement offset within [-0.45 * uncertainty, +0.45 * uncertainty]
    const errFrac = deterministicHash(cable.id, Math.round(faultProgressT * 100)) * 0.9;
    estimatedFaultDistanceKm = Number(
      Math.max(
        0.1,
        Math.min(
          cable.lengthKm,
          trueFaultDistanceKm + errFrac * uncertaintyPlusMinusKm
        )
      ).toFixed(2)
    );

    fresnelReflectionDb = hasOpticalBreak ? -34.2 : null;

    if (hasOpticalBreak && hasElectricalFault) {
      localizationNotes = `Span #${faultSpanIndex} LOS & PFE open-circuit confirmed. C-OTDR Fresnel reflection localized at ${estimatedFaultDistanceKm} km (±${uncertaintyPlusMinusKm} km, ${confidencePct}% conf).`;
    } else if (faultMode === 'shunt-fault') {
      localizationNotes = `Optical continuity intact; PFE shunt fault localized via DC Milliammeter/Resistance Bridge in Span #${faultSpanIndex} at ${estimatedFaultDistanceKm} km (±${uncertaintyPlusMinusKm} km).`;
    } else if (faultMode === 'optical-only-cut') {
      localizationNotes = `PFE constant current intact; C-OTDR fiber fracture localized in Span #${faultSpanIndex} at ${estimatedFaultDistanceKm} km (±${uncertaintyPlusMinusKm} km).`;
    } else {
      localizationNotes = `Supervisory anomaly detected in Span #${faultSpanIndex} near ${estimatedFaultDistanceKm} km (±${uncertaintyPlusMinusKm} km).`;
    }
  }

  // Generate 120 physical backscatter trace points (dB vs km)
  const traceSamples: OtdrTraceSample[] = [];
  const sampleCount = 120;
  const breakT = hasOpticalBreak ? faultProgressT : 1.05;

  for (let i = 0; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const km = Number((t * cable.lengthKm).toFixed(1));
    const spanIdx = Math.min(
      spanCount,
      Math.floor(km / Math.max(1, repeaterSpacingKm)) + 1
    );
    const kmIntoSpan = km % Math.max(1, repeaterSpacingKm);

    let levelDb: number;
    let eventTag: OtdrTraceSample['eventTag'];

    if (t < breakT) {
      // Physical Rayleigh backscatter decay within current span: -alpha * kmIntoSpan
      const spanAttenuationDb = -optSpec.attenuationDbPerKm * kmIntoSpan;
      // Periodic 0.04 dB factory drum splice loss every ~14 km
      const drumSplices = Math.floor(kmIntoSpan / 14) * 0.04;
      // Repeater gain tilt / ripple across the chain
      const chainTiltDb = -(spanIdx - 1) * 0.06;
      const microNoise = deterministicHash(cable.id, i) * 0.25;

      levelDb = Number(
        (-2.2 + spanAttenuationDb - drumSplices + chainTiltDb + microNoise).toFixed(2)
      );
      if (kmIntoSpan < cable.lengthKm / sampleCount && spanIdx > 1) {
        eventTag = 'REPEATER';
      }
    } else if (Math.abs(t - breakT) <= 0.015) {
      // Fresnel reflection spike at cleaved/fractured silica-seawater interface (+3.8 dB above local backscatter)
      const kmAtBreak = (breakT * cable.lengthKm) % Math.max(1, repeaterSpacingKm);
      levelDb = Number(
        (-2.2 - optSpec.attenuationDbPerKm * kmAtBreak + 4.2).toFixed(2)
      );
      eventTag = 'FAULT-FRESNEL';
    } else {
      // Receiver ASE / thermal noise floor past optical break
      const floorNoise = deterministicHash(cable.id, i + 500) * 1.4;
      levelDb = Number((-26.8 + floorNoise).toFixed(2));
      eventTag = 'NOISE-FLOOR';
    }

    traceSamples.push({
      km,
      levelDb,
      spanIndex: spanIdx,
      eventTag,
    });
  }

  return {
    instrumentMode,
    wavelengthNm: 1550.12,
    pulseWidthNs,
    dynamicRangeDb,
    eventDeadZoneM,
    attenuationDeadZoneM,
    fiberAttenuationDbKm: optSpec.attenuationDbPerKm,
    repeaterSpacingKm,
    trueFaultDistanceKm,
    estimatedFaultDistanceKm,
    uncertaintyPlusMinusKm,
    confidencePct,
    faultSpanIndex,
    fresnelReflectionDb,
    localizationNotes,
    traceSamples,
  };
}
