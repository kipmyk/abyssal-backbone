import type { SubseaCable } from '../types/network';

/**
 * Optical Transmission Engineering Engine
 * Implements submarine optical link budgets and OSNR/GSNR/Q/BER models per:
 * - ITU-T Recommendation G.977 (Characteristics of optically amplified optical fibre submarine cable systems)
 * - ITU-T Recommendation G.977.1 (Transverse compatible DWDM applications for repeatered optical fibre submarine cable systems)
 * - ITU-T Recommendation G.976 (Test methods applicable to optical fibre submarine cable systems)
 * - ITU-T G Supplement 41 (Design guidelines for optical fibre submarine cable systems)
 * - ITU-T Recommendation G.654 (Characteristics of a cut-off shifted single-mode optical fibre and cable)
 */

// Physical constants at C-band reference wavelength lambda = 1550.12 nm (f = 193.414 THz)
const PLANCK_H = 6.62607015e-34; // J*s
const OPTICAL_FREQ_HZ = 193.414e12; // 193.414 THz
const REF_BW_HZ = 12.5e9; // 0.1 nm reference bandwidth (12.5 GHz)
// 10 * log10(h * nu * B_ref / 1 mW) ≈ -57.958 dBm
export const QUANTUM_NOISE_FLOOR_DBM =
  10 * Math.log10((PLANCK_H * OPTICAL_FREQ_HZ * REF_BW_HZ) / 1e-3);

// Soft-Decision Forward Error Correction (SD-FEC) threshold per ITU-T G.975.1 / G.977.1
export const SD_FEC_Q_THRESHOLD_DB = 6.0; // corresponds to Q_linear ≈ 1.995, Pre-FEC BER ≈ 2.3e-2

export type OpticalArchitecture =
  | 'repeatered-sdm'       // Post-2020 Space-Division Multiplexing (pump-shared EDFA, G.654.E ULL fiber, 12-24 fiber pairs)
  | 'repeatered-coherent'  // 2012-2019 Coherent DWDM (G.654.B/C fiber, 6-8 fiber pairs)
  | 'repeatered-legacy'    // Pre-2012 Dispersion-managed upgraded to coherent (G.652/G.655, higher attenuation)
  | 'repeaterless-unregen' // Short-haul (<400 km) unrepeatered with shore ROPA/EDFA only
  | 'terrestrial-dwdm';    // Terrestrial G.652.D inline amplified mesh

export interface OpticalSystemSpec {
  architecture: OpticalArchitecture;
  fiberStandard: 'ITU-T G.654.E' | 'ITU-T G.654.B' | 'ITU-T G.652.D';
  attenuationDbPerKm: number;       // alpha (dB/km) at 1550 nm
  spliceLossDbPerKm: number;        // distributed factory joint & splice loss (dB/km)
  chromaticDispersionPsNmKm: number;// D (ps/(nm*km))
  pmdCoeffPsSqrtKm: number;         // D_PMD (ps/sqrt(km))
  effectiveAreaUm2: number;         // A_eff (um^2)
  nonlinearCoeffPerWKm: number;     // gamma (1/(W*km))
  launchPowerDbm: number;           // Per-channel launch power P_tx (dBm)
  edfaNoiseFigureDb: number;        // Amplifier NF (dB)
  nominalSpanLengthKm: number;      // Nominal repeater spacing (km)
  channelBaudRateGbaud: number;     // Symbol rate R_s (Gbaud)
  eolAgingAllowanceDb: number;      // 25-year cable & repair splice aging budget (dB)
}

export interface OpticalPerformanceMetrics {
  architecture: OpticalArchitecture;
  fiberStandard: string;
  repeaterCount: number;
  spanCount: number;
  spanLengthKm: number;
  fiberAttenuationDbPerKm: number;
  spanLossDb: number;
  totalFiberLossDb: number;
  launchPowerDbm: number;
  edfaGainDb: number;
  edfaNoiseFigureDb: number;
  aseNoiseAccumulationDbm: number;
  osnrLinDb: number;                // Linear ASE-only OSNR in 0.1 nm (dB)
  snrNliDb: number;                 // Nonlinear Kerr interference SNR (dB)
  gsnrDb: number;                   // Generalized SNR combining ASE + NLI + penalties (dB)
  chromaticDispersionPsNm: number;  // Total accumulated CD (ps/nm)
  pmdPs: number;                    // Accumulated PMD (ps)
  qFactorDb: number;                // Q-factor (dB, 20*log10(Q_linear))
  qFactorLinear: number;            // Q_linear
  preFecBer: number;                // Pre-FEC Bit Error Ratio
  postFecBer: number;               // Post-FEC Bit Error Ratio after SD-FEC
  bolMarginDb: number;              // Beginning-of-Life margin above SD-FEC threshold (dB)
  eolMarginDb: number;              // End-of-Life (25-yr + repair splices) margin above SD-FEC (dB)
  opticalCarrierUp: boolean;        // True if Q >= SD_FEC_Q_THRESHOLD_DB and PFE power is valid
}

/**
 * Complementary error function erfc(x) using Abramowitz & Stegun 7.1.26 rational approximation
 * (max error < 1.5e-7) for deterministic Pre-FEC BER calculation: BER = 0.5 * erfc(Q / sqrt(2)).
 */
export function erfcApprox(x: number): number {
  if (x < 0) return 2 - erfcApprox(-x);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1.0 / (1.0 + p * x);
  const poly = (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t;
  return poly * Math.exp(-x * x);
}

/**
 * Derives realistic ITU-T optical transmission specifications from the cable's commissioning era,
 * length, and terrestrial/subsea classification.
 */
export function deriveOpticalSpec(cable: SubseaCable): OpticalSystemSpec {
  if (cable.isTerrestrial) {
    return {
      architecture: 'terrestrial-dwdm',
      fiberStandard: 'ITU-T G.652.D',
      attenuationDbPerKm: 0.202,
      spliceLossDbPerKm: 0.008,
      chromaticDispersionPsNmKm: 17.0,
      pmdCoeffPsSqrtKm: 0.08,
      effectiveAreaUm2: 80,
      nonlinearCoeffPerWKm: 1.3,
      launchPowerDbm: 0.5,
      edfaNoiseFigureDb: 5.2,
      nominalSpanLengthKm: 82,
      channelBaudRateGbaud: 64,
      eolAgingAllowanceDb: 2.2,
    };
  }

  // Short subsea links (<380 km) use repeaterless architecture with remote optically pumped amplifiers (ROPA)
  if (cable.lengthKm <= 380) {
    return {
      architecture: 'repeaterless-unregen',
      fiberStandard: 'ITU-T G.654.E',
      attenuationDbPerKm: 0.154,
      spliceLossDbPerKm: 0.003,
      chromaticDispersionPsNmKm: 20.5,
      pmdCoeffPsSqrtKm: 0.03,
      effectiveAreaUm2: 130,
      nonlinearCoeffPerWKm: 0.78,
      launchPowerDbm: 14.0, // High shore launch power for unrepeatered span
      edfaNoiseFigureDb: 4.5,
      nominalSpanLengthKm: cable.lengthKm,
      channelBaudRateGbaud: 64,
      eolAgingAllowanceDb: 1.8,
    };
  }

  // Modern SDM cables (RFS >= 2020: 2Africa, Equiano, Grace Hopper, Dunant, PEACE, Apricot, Blue-Raman)
  if (cable.rfsYear >= 2020) {
    return {
      architecture: 'repeatered-sdm',
      fiberStandard: 'ITU-T G.654.E',
      attenuationDbPerKm: 0.156,
      spliceLossDbPerKm: 0.004,
      chromaticDispersionPsNmKm: 20.8,
      pmdCoeffPsSqrtKm: 0.035,
      effectiveAreaUm2: 125,
      nonlinearCoeffPerWKm: 0.82,
      launchPowerDbm: -0.5, // SDM optimizes total power efficiency via lower per-channel launch power
      edfaNoiseFigureDb: 4.6,
      nominalSpanLengthKm: 86,
      channelBaudRateGbaud: 96,
      eolAgingAllowanceDb: 2.4,
    };
  }

  // 2012-2019 Coherent Submarine Systems (AAE-1, SMW5, MAREA, FASTER, SACS, Monet, INDIGO)
  if (cable.rfsYear >= 2012) {
    return {
      architecture: 'repeatered-coherent',
      fiberStandard: 'ITU-T G.654.B',
      attenuationDbPerKm: 0.166,
      spliceLossDbPerKm: 0.005,
      chromaticDispersionPsNmKm: 20.0,
      pmdCoeffPsSqrtKm: 0.045,
      effectiveAreaUm2: 112,
      nonlinearCoeffPerWKm: 0.92,
      launchPowerDbm: 0.5,
      edfaNoiseFigureDb: 4.9,
      nominalSpanLengthKm: 78,
      channelBaudRateGbaud: 64,
      eolAgingAllowanceDb: 2.8,
    };
  }

  // Pre-2012 Legacy Submarine Systems (SEACOM, EASSy, FALCON, MainOne)
  return {
    architecture: 'repeatered-legacy',
    fiberStandard: 'ITU-T G.652.D',
    attenuationDbPerKm: 0.182,
    spliceLossDbPerKm: 0.007,
    chromaticDispersionPsNmKm: 17.2,
    pmdCoeffPsSqrtKm: 0.075,
    effectiveAreaUm2: 85,
    nonlinearCoeffPerWKm: 1.22,
    launchPowerDbm: 1.0,
    edfaNoiseFigureDb: 5.3,
    nominalSpanLengthKm: 68,
    channelBaudRateGbaud: 34,
    eolAgingAllowanceDb: 3.4,
  };
}

export interface OpticalFaultModifiers {
  severed?: boolean;
  unpoweredRepeaters?: number;  // Count of repeaters lacking adequate PFE current
  degradedRepeaters?: number;   // Count of repeaters with pump laser degradation (gain droop)
  extraSpliceLossDb?: number;   // Additional repair splice / universal joint loss (dB)
}

/**
 * Calculates end-to-end submarine optical transmission performance from physical parameters
 * per ITU-T G.977 and G Supplement 41.
 */
export function computeOpticalPerformance(
  cable: SubseaCable,
  modifiers: OpticalFaultModifiers = {}
): OpticalPerformanceMetrics {
  const spec = deriveOpticalSpec(cable);

  const isRepeaterless = spec.architecture === 'repeaterless-unregen';
  const spanCount = isRepeaterless
    ? 1
    : Math.max(2, Math.ceil(cable.lengthKm / spec.nominalSpanLengthKm));
  const repeaterCount = isRepeaterless ? 0 : Math.max(1, spanCount - 1);
  const spanLengthKm = Number((cable.lengthKm / spanCount).toFixed(2));

  const effectiveAlpha = spec.attenuationDbPerKm + spec.spliceLossDbPerKm;
  const extraPerSpanDb = (modifiers.extraSpliceLossDb ?? 0) / spanCount;
  const spanLossDb = Number((effectiveAlpha * spanLengthKm + extraPerSpanDb).toFixed(2));
  const totalFiberLossDb = Number((spanLossDb * spanCount).toFixed(1));

  // Total accumulated Chromatic Dispersion (ps/nm) and PMD (ps)
  const chromaticDispersionPsNm = Math.round(
    spec.chromaticDispersionPsNmKm * cable.lengthKm
  );
  const pmdPs = Number(
    (spec.pmdCoeffPsSqrtKm * Math.sqrt(cable.lengthKm)).toFixed(2)
  );

  // If optical fiber is physically severed, signal is lost (LOS)
  if (modifiers.severed) {
    return {
      architecture: spec.architecture,
      fiberStandard: spec.fiberStandard,
      repeaterCount,
      spanCount,
      spanLengthKm,
      fiberAttenuationDbPerKm: spec.attenuationDbPerKm,
      spanLossDb,
      totalFiberLossDb,
      launchPowerDbm: spec.launchPowerDbm,
      edfaGainDb: 0,
      edfaNoiseFigureDb: spec.edfaNoiseFigureDb,
      aseNoiseAccumulationDbm: -60,
      osnrLinDb: 0,
      snrNliDb: 0,
      gsnrDb: 0,
      chromaticDispersionPsNm,
      pmdPs,
      qFactorDb: 0,
      qFactorLinear: 0,
      preFecBer: 0.5,
      postFecBer: 0.5,
      bolMarginDb: -SD_FEC_Q_THRESHOLD_DB,
      eolMarginDb: -SD_FEC_Q_THRESHOLD_DB,
      opticalCarrierUp: false,
    };
  }

  // Evaluate EDFA gain compensation and unpowered/degraded repeater penalties
  const unpowered = modifiers.unpoweredRepeaters ?? 0;
  const degraded = modifiers.degradedRepeaters ?? 0;

  // An unpowered EDFA behaves as a high-loss erbium-doped fiber absorber (~25 dB insertion loss per unpowered pod)
  const unpoweredPenaltyDb = unpowered * 25.0;
  // A degraded repeater with a failed redundant 980nm pump diode suffers ~4.2 dB gain droop and +2.1 dB NF
  const degradedPenaltyDb = degraded * 4.2;
  const effectiveNfDb = spec.edfaNoiseFigureDb + (degraded > 0 ? 1.8 : 0);

  // Nominal EDFA gain equals span loss in transparent gain-flattened submarine links (ITU-T G.977)
  const edfaGainDb = isRepeaterless
    ? Math.min(32, spanLossDb * 0.55)
    : Number(Math.max(0, spanLossDb - (degraded > 0 ? 1.2 : 0)).toFixed(2));

  // ITU-T G.977 / G Suppl. 41 Linear ASE OSNR (in 0.1 nm / 12.5 GHz reference bandwidth):
  // OSNR_ASE(dB) = P_launch(dBm) - L_span(dB) - NF(dB) - 10*log10(N_spans) - QUANTUM_NOISE_FLOOR_DBM
  const spanCountDb = 10 * Math.log10(Math.max(1, spanCount));
  const asePerSpanDbm =
    QUANTUM_NOISE_FLOOR_DBM + spanLossDb + effectiveNfDb;
  const aseNoiseAccumulationDbm = Number(
    (asePerSpanDbm + spanCountDb).toFixed(2)
  );

  const osnrLinDbRaw =
    spec.launchPowerDbm -
    spanLossDb -
    effectiveNfDb -
    spanCountDb -
    QUANTUM_NOISE_FLOOR_DBM -
    unpoweredPenaltyDb -
    degradedPenaltyDb;
  const osnrLinDb = Number(Math.max(0, osnrLinDbRaw).toFixed(2));

  // Nonlinear Kerr Impairment (Gaussian Noise model approximation per ITU-T G Suppl. 41):
  // Effective length L_eff = (1 - exp(-alpha_lin * L)) / alpha_lin
  const alphaNepersPerKm = (spec.attenuationDbPerKm * Math.LN10) / 10;
  const lEffKm =
    (1 - Math.exp(-alphaNepersPerKm * spanLengthKm)) / alphaNepersPerKm;
  const launchPowerWatts = Math.pow(10, (spec.launchPowerDbm - 30) / 10);
  // NLI noise power scales with (gamma * L_eff * P_ch)^2 * P_ch * N_spans
  const nliRatio =
    1.8e-3 *
    Math.pow(spec.nonlinearCoeffPerWKm * lEffKm * launchPowerWatts, 2) *
    Math.pow(spanCount, 0.92);
  const snrNliDb = Number(
    Math.max(8, Math.min(36, -10 * Math.log10(Math.max(1e-5, nliRatio)))).toFixed(2)
  );

  // Combine ASE OSNR, Nonlinear SNR, and PMD/transceiver implementation penalty into GSNR
  const osnrLin = Math.pow(10, osnrLinDb / 10);
  const snrNliLin = Math.pow(10, snrNliDb / 10);
  const modemImplementationSnrLin = Math.pow(10, 23.5 / 10); // Back-to-back coherent transponder ceiling
  const gsnrLin =
    osnrLin <= 0.01
      ? 0.001
      : 1 / (1 / osnrLin + 1 / snrNliLin + 1 / modemImplementationSnrLin);

  // PMD penalty in dB (ITU-T G.691: Δ_PMD ≈ 0.025 * (PMD / T_sym)^2)
  const symbolPeriodPs = 1000 / spec.channelBaudRateGbaud;
  const pmdPenaltyDb = Math.min(2.5, 0.025 * Math.pow(pmdPs / symbolPeriodPs, 2));
  const gsnrDb = Number(
    Math.max(0, 10 * Math.log10(gsnrLin) - pmdPenaltyDb).toFixed(2)
  );

  // Convert GSNR (in 12.5 GHz ref bandwidth) to electrical SNR at symbol rate R_s for DP-QPSK / DP-16QAM
  // Q^2 (linear) ≈ GSNR_lin * (B_ref / R_s_effective)
  const bwScalingDb = 10 * Math.log10(12.5 / (spec.channelBaudRateGbaud * 0.28));
  const qFactorDb = Number(Math.max(0, gsnrDb + bwScalingDb).toFixed(2));
  const qFactorLinear = Number(Math.pow(10, qFactorDb / 20).toFixed(3));

  // Pre-FEC BER = 0.5 * erfc(Q_linear / sqrt(2))
  const preFecBer = Number(
    (0.5 * erfcApprox(qFactorLinear / Math.SQRT2)).toExponential(2)
  );

  // Post-FEC BER after Soft-Decision LDPC waterfall
  const bolMarginDb = Number((qFactorDb - SD_FEC_Q_THRESHOLD_DB).toFixed(2));
  const eolMarginDb = Number(
    (bolMarginDb - spec.eolAgingAllowanceDb * 0.45).toFixed(2)
  );
  const opticalCarrierUp = qFactorDb >= SD_FEC_Q_THRESHOLD_DB && unpowered <= 1;

  const postFecBer = opticalCarrierUp
    ? Number(Math.max(1e-15, Math.pow(10, -12 - bolMarginDb * 1.4)).toExponential(1))
    : preFecBer;

  return {
    architecture: spec.architecture,
    fiberStandard: spec.fiberStandard,
    repeaterCount,
    spanCount,
    spanLengthKm,
    fiberAttenuationDbPerKm: spec.attenuationDbPerKm,
    spanLossDb,
    totalFiberLossDb,
    launchPowerDbm: spec.launchPowerDbm,
    edfaGainDb,
    edfaNoiseFigureDb: effectiveNfDb,
    aseNoiseAccumulationDbm,
    osnrLinDb,
    snrNliDb,
    gsnrDb,
    chromaticDispersionPsNm,
    pmdPs,
    qFactorDb,
    qFactorLinear,
    preFecBer,
    postFecBer,
    bolMarginDb,
    eolMarginDb,
    opticalCarrierUp,
  };
}
