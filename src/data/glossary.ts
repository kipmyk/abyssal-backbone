export interface GlossaryEntry {
  term: string;
  shortLabel: string;
  category: 'Optical' | 'Power (PFE)' | 'BGP-4' | 'Marine';
  definition: string;
}

export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  {
    term: 'CLS',
    shortLabel: 'Cable Landing Station',
    category: 'Marine',
    definition:
      'Coastal facility where a submarine cable comes ashore, housing Power Feed Equipment (PFE), SLTE line-terminating optical equipment, and terrestrial border routers.',
  },
  {
    term: 'GSNR',
    shortLabel: 'Generalized Signal-to-Noise Ratio',
    category: 'Optical',
    definition:
      'Total end-to-end optical signal-to-noise ratio (dB) combining linear ASE noise from EDFA repeaters with nonlinear Kerr fiber interference (NLI).',
  },
  {
    term: 'Q-factor',
    shortLabel: 'Optical Quality Factor',
    category: 'Optical',
    definition:
      'Logarithmic eye-opening quality metric (dB). Signals above the Soft-Decision FEC threshold (6.0 dB in this model) remain error-free post-FEC; dropping below triggers LOS.',
  },
  {
    term: 'EDFA',
    shortLabel: 'Erbium-Doped Fiber Amplifier',
    category: 'Optical',
    definition:
      'Subsea optical repeater spaced every ~65–95 km that boosts 1550 nm C-band signals optically without O-E-O regeneration, powered over the cable copper conductor.',
  },
  {
    term: 'PFE',
    shortLabel: 'Power Feed Equipment',
    category: 'Power (PFE)',
    definition:
      'High-voltage constant-current DC terminal feed (up to +/-12 kV) driving repeater pump lasers through the cable copper conductor using sea-earth return.',
  },
  {
    term: 'C-OTDR',
    shortLabel: 'Coherent Optical Time-Domain Reflectometry',
    category: 'Optical',
    definition:
      'Remote telemetry method measuring coherent Rayleigh backscatter through repeater loopback paths to pinpoint deep-sea optical breaks within ~1-3 km.',
  },
  {
    term: 'SD-FEC',
    shortLabel: 'Soft-Decision Forward Error Correction',
    category: 'Optical',
    definition:
      'Coherent DSP error coding that turns noisy raw line bit errors (pre-FEC BER up to ~2.3e-2) into error-free post-FEC payload frames.',
  },
  {
    term: 'AS_PATH',
    shortLabel: 'BGP Autonomous System Path',
    category: 'BGP-4',
    definition:
      'Ordered sequence of Autonomous System Numbers (ASNs) traversed by a BGP route advertisement; prevents loops and serves as tie-breaker step #2 in RFC 4271.',
  },
  {
    term: 'LOCAL_PREF',
    shortLabel: 'BGP Local Preference',
    category: 'BGP-4',
    definition:
      'Highest-priority RFC 4271 policy attribute (higher wins) shared inside an AS to steer outbound traffic toward preferred customer, peer, or transit paths.',
  },
  {
    term: 'MED',
    shortLabel: 'Multi-Exit Discriminator',
    category: 'BGP-4',
    definition:
      'Optional non-transitive BGP metric exchanged between neighboring ASes (lower wins) to hint preferred entry points when LOCAL_PREF and AS_PATH tie.',
  },
  {
    term: 'Valley-free',
    shortLabel: 'Gao-Rexford Valley-Free Routing',
    category: 'BGP-4',
    definition:
      'Internet routing invariant where an AS never transit-routes traffic from one upstream provider/peer to another; violating it creates a BGP route leak.',
  },
  {
    term: 'NO_EXPORT',
    shortLabel: 'Well-Known BGP Community (RFC 1997)',
    category: 'BGP-4',
    definition:
      'Community tag instructing a BGP router not to advertise a learned prefix beyond the local Autonomous System boundary.',
  },
];

export const INLINE_TERM_HINTS: Record<string, { title: string; body: string }> = {
  cls: {
    title: 'CLS (Cable Landing Station) & AS',
    body: 'Each landing hub maps a physical submarine shore station to a representative border Autonomous System (AS) exchanging eBGP/iBGP routes.',
  },
  gsnr: {
    title: 'GSNR & Linear OSNR (ITU-T G.977)',
    body: 'GSNR combines amplifier ASE noise (0.1 nm reference bandwidth) and fiber nonlinearity. If GSNR drops too low, Q-factor falls below 6.0 dB.',
  },
  qfactor: {
    title: 'Q-Factor & SD-FEC Threshold',
    body: 'Pre-FEC margin in dB above the 6.0 dB Soft-Decision FEC cliff. Positive EOL Margin indicates 25-year aging & repair splice headroom.',
  },
  pfe: {
    title: 'Constant-Current PFE Feed',
    body: 'Bipolar HVDC loop from both shore terminals keeps subsea EDFA repeaters powered. On an insulation shunt fault, PFE reconfigures to single-end feed.',
  },
  bgp: {
    title: 'RFC 4271 BGP-4 Decision Order',
    body: 'Selects best path strictly by Highest LOCAL_PREF -> Shortest AS_PATH -> Lowest ORIGIN -> Lowest MED -> eBGP over iBGP -> Shortest IGP RTT.',
  },
  edfa: {
    title: 'EDFA Repeaters & Span Loss',
    body: 'Undersea optical amplifiers placed every 65-95 km compensate fiber attenuation (~0.155-0.195 dB/km) while adding Amplified Spontaneous Emission (ASE) noise.',
  },
  cotdr: {
    title: 'C-OTDR Fault Localization',
    body: 'Coherent Optical Time-Domain Reflectometry measures backscatter through repeater loopbacks to estimate subsea fault distance (+/- 0.2 to 3.7 km).',
  },
  aspath: {
    title: 'AS_PATH & Valley-Free Policy',
    body: 'Tracks traversed Autonomous Systems to prevent loops. Exporting a provider route back to another provider breaks valley-free routing and causes leaks.',
  },
};

export interface ModelAssumptionGroup {
  title: string;
  items: string[];
}

export const MODEL_ASSUMPTIONS: ModelAssumptionGroup[] = [
  {
    title: 'Optical & Physical Layer (ITU-T G.977 / G.654)',
    items: [
      'C-band carrier reference: 193.414 THz (1550.12 nm), 12.5 GHz reference bandwidth (quantum noise floor ~ -57.96 dBm).',
      'Group refractive index n_g ~ 1.4682 gives silica fiber propagation velocity 204.19 km/ms plus 1.4 ms one-way CLS forwarding latency.',
      'SD-FEC carrier threshold fixed at Q >= 6.0 dB (pre-FEC BER ~ 2.3e-2); unpowered EDFA repeaters act as high-loss absorbers dropping optical carrier.',
    ],
  },
  {
    title: 'BGP-4 Control Plane (RFC 4271 / Gao-Rexford)',
    items: [
      'Deterministic Bellman-Ford path-vector convergence up to 16 AS hops across representative Tier-1 / Tier-2 CLS Autonomous Systems.',
      'Parallel active trunks between the same two CLS stations are load-balanced in the data plane by projected utilization and propagation RTT.',
      'Queueing delay adds M/M/1/K latency penalty above 75% trunk utilization; packet loss rises above 92%.',
    ],
  },
  {
    title: 'Bathymetry, PFE & Marine Repair',
    items: [
      'Analytical bathymetry models shelf/slope/trench relief (-35 m to -8,900 m) for armor class (DA/SA/LWP/LW) and hydrostatic pressure (0.101 + 0.01008*d MPa).',
      'Constant-current DC loop calculates terminal bipolar voltage split, shunt zero-volt point, and 15-stage cable ship mobilization timelines.',
    ],
  },
];

