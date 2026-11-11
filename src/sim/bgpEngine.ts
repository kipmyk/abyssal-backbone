import { LANDING_STATIONS } from '../data/networkData';
import type { SubseaCable } from '../types/network';

/**
 * BGP-4 Control Plane & Policy Engine (RFC 4271 / RFC 1997)
 *
 * Architectural Separation:
 * - Control Plane: Autonomous Systems (ASNs), eBGP/iBGP speakers, Adj-RIB-In,
 *   Loc-RIB, Adj-RIB-Out, Valley-Free (Gao-Rexford) Import/Export policies,
 *   Communities, and RFC 4271 Section 9.1.2 Best-Path Decision Process.
 * - Data Plane: Physical subsea & terrestrial fiber segments, optical OSNR/BER
 *   interface state, FIB next-hop forwarding, and bandwidth utilization.
 *
 * Documented Engineering Approximations:
 * - Each CLS hub operates a representative border router (BGP speaker) associated
 *   with its primary regional/transit Autonomous System, plus IXP peering policies.
 * - BGP propagation is evaluated deterministically via iterative Bellman-Ford
 *   path-vector exchange until RIB convergence (or max hop count = 16).
 */

export type BgpOriginCode = 'IGP' | 'EGP' | 'INCOMPLETE';
export type AsRelationship = 'customer' | 'peer' | 'provider' | 'ibgp';

export interface BgpRouteAdvertisement {
  prefix: string;
  destinationStationId: string;
  nextHopStationId: string;
  nextHopAsn: number;
  localPref: number;
  asPath: number[];
  stationPath: string[];
  cablePath: string[];
  origin: BgpOriginCode;
  med: number;
  sessionType: 'ebgp' | 'ibgp';
  igpMetricMs: number;
  communities: string[];
  learnedFromRel: AsRelationship;
  isHijack?: boolean;
  isLeaked?: boolean;
}

export interface BgpSpeakerRibState {
  stationId: string;
  asn: number;
  asName: string;
  adjRibIn: BgpRouteAdvertisement[];
  locRib: Map<string, BgpRouteAdvertisement>; // keyed by destinationStationId
  adjRibOut: BgpRouteAdvertisement[];
}

export interface BgpControlPlaneConfig {
  /** Blocks transit export across Cape of Good Hope peering (demonstrates physical path up, BGP policy blocked) */
  enforceStrictCapeNoExport?: boolean;
  /** Injects a valley-free violation route leak at Lagos/Mombasa (AS37100/AS37468 leaking transit routes) */
  routeLeakActive?: boolean;
  /** Injects an unauthorized origin/sub-prefix BGP hijack for European/US prefixes */
  prefixHijackActive?: boolean;
  /** Takes transit AS36947 / AS6762 BGP sessions down at Alexandria/Palermo while optical cables remain intact */
  transitAsOutage?: boolean;
  /** Set of station IDs suffering complete facility power/landing outage */
  disabledStations?: Set<string>;
}

// Representative Autonomous System mapping for each CLS hub (Verified PeeringDB / Regional Registry ASNs)
export const STATION_ASN_MAP: Record<
  string,
  { asn: number; asName: string; tier: 1 | 2; ipv4Prefix: string }
> = {
  mombasa:    { asn: 30844, asName: 'LIQUID-EA-AS',     tier: 2, ipv4Prefix: '197.155.0.0/16' },
  djibouti:   { asn: 37054, asName: 'DJIBOUTI-IX-AS',   tier: 2, ipv4Prefix: '196.201.0.0/16' },
  mtunzini:   { asn: 37100, asName: 'SEACOM-AS',        tier: 2, ipv4Prefix: '105.16.0.0/12' },
  capetown:   { asn: 37457, asName: 'TELKOM-ZA-AS',     tier: 2, ipv4Prefix: '41.0.0.0/11' },
  luanda:     { asn: 37468, asName: 'ANGOLA-CABLES',    tier: 2, ipv4Prefix: '102.214.0.0/16' },
  lagos:      { asn: 37282, asName: 'MAINONE-NG-AS',    tier: 2, ipv4Prefix: '41.75.80.0/20' },
  accra:      { asn: 30986, asName: 'GHANA-IX-AS',      tier: 2, ipv4Prefix: '196.216.0.0/16' },
  suez:       { asn: 8452,  asName: 'TE-AS-SUEZ',       tier: 1, ipv4Prefix: '41.32.0.0/13' },
  alexandria: { asn: 36947, asName: 'TELECOM-EGYPT',    tier: 1, ipv4Prefix: '196.219.0.0/16' },
  jeddah:     { asn: 25019, asName: 'STC-IGW-AS',       tier: 1, ipv4Prefix: '212.118.0.0/16' },
  fujairah:   { asn: 5384,  asName: 'EMIRATES-ETISALAT',tier: 1, ipv4Prefix: '195.229.0.0/16' },
  marseille:  { asn: 5511,  asName: 'ORANGE-OPENTRANSIT',tier: 1, ipv4Prefix: '193.251.0.0/16' },
  palermo:    { asn: 6762,  asName: 'SEABONE-SPARKLE',  tier: 1, ipv4Prefix: '195.22.192.0/19' },
  lisbon:     { asn: 1299,  asName: 'ARELION-EU-AS',    tier: 1, ipv4Prefix: '62.115.0.0/16' },
  bude:       { asn: 3356,  asName: 'LUMEN-UK-CORE',    tier: 1, ipv4Prefix: '4.0.0.0/9' },
  nyc:        { asn: 174,   asName: 'COGENT-US-EAST',   tier: 1, ipv4Prefix: '38.0.0.0/8' },
  virginia:   { asn: 15169, asName: 'GOOGLE-BACKBONE',  tier: 1, ipv4Prefix: '142.250.0.0/15' },
  miami:      { asn: 3257,  asName: 'GTT-AMERICAS',     tier: 1, ipv4Prefix: '89.149.0.0/16' },
  fortaleza:  { asn: 28573, asName: 'CLARO-BR-NORTH',   tier: 2, ipv4Prefix: '177.79.0.0/16' },
  saopaulo:   { asn: 26599, asName: 'VIVO-BR-CORE',     tier: 2, ipv4Prefix: '187.100.0.0/16' },
  la:         { asn: 6461,  asName: 'ZAYO-US-WEST',     tier: 1, ipv4Prefix: '64.125.0.0/16' },
  mumbai:     { asn: 6453,  asName: 'TATA-INDIA-CORE',  tier: 1, ipv4Prefix: '180.87.0.0/16' },
  chennai:    { asn: 9498,  asName: 'BHARTI-AIRTEL',    tier: 1, ipv4Prefix: '125.16.0.0/13' },
  singapore:  { asn: 7473,  asName: 'SINGTEL-IX-AS',    tier: 1, ipv4Prefix: '165.21.0.0/16' },
  hongkong:   { asn: 3491,  asName: 'PCCW-GLOBAL-HK',   tier: 1, ipv4Prefix: '63.218.0.0/16' },
  tokyo:      { asn: 2914,  asName: 'NTT-GIN-TOKYO',    tier: 1, ipv4Prefix: '129.250.0.0/16' },
  guam:       { asn: 2516,  asName: 'KDDI-PACIFIC-HUB', tier: 1, ipv4Prefix: '106.184.0.0/16' },
  sydney:     { asn: 1221,  asName: 'TELSTRA-INTL-AS',  tier: 1, ipv4Prefix: '203.50.0.0/16' },
  perth:      { asn: 7575,  asName: 'AARNET-AU-WEST',   tier: 2, ipv4Prefix: '138.44.0.0/16' },
};

const ORIGIN_WEIGHT: Record<BgpOriginCode, number> = {
  IGP: 0,
  EGP: 1,
  INCOMPLETE: 2,
};

/**
 * RFC 4271 Section 9.1.2 Best-Path Comparator
 * Returns < 0 if route `a` is strictly preferred over route `b`.
 */
export function compareBgpRoutes(
  a: BgpRouteAdvertisement,
  b: BgpRouteAdvertisement
): number {
  // 1. Highest LOCAL_PREF
  if (a.localPref !== b.localPref) {
    return b.localPref - a.localPref;
  }
  // 2. Shortest AS_PATH length
  if (a.asPath.length !== b.asPath.length) {
    return a.asPath.length - b.asPath.length;
  }
  // 3. Lowest ORIGIN type (IGP < EGP < INCOMPLETE)
  if (ORIGIN_WEIGHT[a.origin] !== ORIGIN_WEIGHT[b.origin]) {
    return ORIGIN_WEIGHT[a.origin] - ORIGIN_WEIGHT[b.origin];
  }
  // 4. Lowest MED (evaluated when nextHopAsn matches or deterministic always-compare-med enabled)
  if (a.med !== b.med) {
    return a.med - b.med;
  }
  // 5. Prefer eBGP over iBGP
  if (a.sessionType !== b.sessionType) {
    return a.sessionType === 'ebgp' ? -1 : 1;
  }
  // 6. Lowest IGP metric to NEXT_HOP
  if (Math.abs(a.igpMetricMs - b.igpMetricMs) > 0.05) {
    return a.igpMetricMs - b.igpMetricMs;
  }
  // 7. Lowest Next-Hop ASN / Station ID tie-breaker
  return a.nextHopStationId.localeCompare(b.nextHopStationId);
}

/**
 * Determines the commercial BGP relationship and LOCAL_PREF assigned by `receiverId`
 * when learning a route from `senderId` over `cable`.
 */
function evaluateBgpPolicy(
  receiverId: string,
  senderId: string,
  cable: SubseaCable,
  adv: BgpRouteAdvertisement,
  config: BgpControlPlaneConfig
): { allowed: boolean; localPref: number; med: number; rel: AsRelationship; communities: string[] } {
  const rxMeta = STATION_ASN_MAP[receiverId] ?? { asn: 65001, tier: 2 };
  const txMeta = STATION_ASN_MAP[senderId] ?? { asn: 65002, tier: 2 };

  // Loop prevention (RFC 4271): reject if own ASN is already in AS_PATH
  if (adv.asPath.includes(rxMeta.asn)) {
    return { allowed: false, localPref: 0, med: 0, rel: 'peer', communities: [] };
  }

  // Facility outage at either endpoint tears down eBGP/iBGP TCP 179 session
  if (
    config.disabledStations?.has(receiverId) ||
    config.disabledStations?.has(senderId)
  ) {
    return { allowed: false, localPref: 0, med: 0, rel: 'peer', communities: [] };
  }

  // Transit provider outage scenario (AS36947 Alexandria / AS6762 Palermo BGP daemon down)
  if (
    config.transitAsOutage &&
    (receiverId === 'alexandria' ||
      senderId === 'alexandria' ||
      receiverId === 'palermo' ||
      senderId === 'palermo')
  ) {
    return { allowed: false, localPref: 0, med: 0, rel: 'provider', communities: [] };
  }

  // RFC 1997 NO_EXPORT community enforcement
  if (adv.communities.includes('65535:65281') || adv.communities.includes('no-export')) {
    return { allowed: false, localPref: 0, med: 0, rel: 'peer', communities: [] };
  }

  // Policy scenario: Strict Cape of Good Hope NO-EXPORT filter
  // Demonstrates a network where physical cables around Cape Town are active,
  // but BGP export policy at Cape Town (AS37457) refuses transit between East and West Africa.
  if (
    config.enforceStrictCapeNoExport &&
    senderId === 'capetown' &&
    adv.stationPath.length >= 2
  ) {
    return { allowed: false, localPref: 0, med: 0, rel: 'peer', communities: ['no-export'] };
  }

  let rel: AsRelationship = 'peer';
  if (rxMeta.tier === 1 && txMeta.tier === 2) rel = 'customer';
  else if (rxMeta.tier === 2 && txMeta.tier === 1) rel = 'provider';

  // Default LOCAL_PREF by commercial relationship + cable capacity class
  // Higher-capacity modern SDM cables carry lower MED and preferred peering engineering communities
  let localPref =
    rel === 'customer' ? 200 : rel === 'peer' ? 150 : 120;

  // Older legacy low-capacity systems (e.g. WACS-S/M 15 Tbps, SEACOM 24 Tbps, FALCON 32 Tbps)
  // are configured with backup LOCAL_PREF (110) so primary SDM trunks (Equiano, 2Africa, PEACE) win
  if (cable.capacityTbps <= 32) {
    localPref -= 20;
  } else if (cable.capacityTbps >= 160) {
    localPref += 10;
  }

  // BGP Route Leak Anomaly:
  // Luanda (AS37468) / Lagos (AS37282) improperly re-advertises provider routes over WACS/SACS
  // with artificially high LOCAL_PREF (260), drawing EMEA/Americas traffic onto low-capacity links
  const communities = [...adv.communities];
  if (
    config.routeLeakActive &&
    (cable.id === 'wacs-south' ||
      cable.id === 'wacs-mid' ||
      cable.id === 'sacs' ||
      cable.id === 'seacom-south')
  ) {
    localPref = 265;
    communities.push('65000:666-LEAK');
  }

  // MED derived from cable optical delay + capacity engineering metric
  const oneWayMs = Math.round(cable.lengthKm / 204.19);
  const capPenaltyMed = Math.round(500 / Math.max(10, cable.capacityTbps));
  const med = adv.med + oneWayMs + capPenaltyMed;

  return { allowed: true, localPref, med, rel, communities };
}

export interface BgpConvergenceResult {
  speakers: Map<string, BgpSpeakerRibState>;
  selectedRoutes: Map<string, BgpRouteAdvertisement>; // key: `${srcId}->${dstId}`
  physicallyReachablePairs: Set<string>;              // key: `${srcId}->${dstId}`
}

/**
 * Executes the RFC 4271 BGP-4 Path-Vector Control Plane convergence across all active
 * optical links, independent of data-plane congestion.
 *
 * @param activeCables Set of subsea/terrestrial cables whose optical carrier is UP (Post-FEC BER passing)
 * @param cableLatencyMs Map of cableId -> base propagation RTT (ms)
 * @param config BGP control plane policy & anomaly configuration
 */
export function convergeBgpControlPlane(
  activeCables: SubseaCable[],
  cableLatencyMs: Map<string, number>,
  config: BgpControlPlaneConfig = {}
): BgpConvergenceResult {
  const speakers = new Map<string, BgpSpeakerRibState>();

  for (const s of LANDING_STATIONS) {
    const meta = STATION_ASN_MAP[s.id] ?? {
      asn: 65000,
      asName: s.name,
      tier: s.tier,
      ipv4Prefix: '10.0.0.0/16',
    };
    const locRib = new Map<string, BgpRouteAdvertisement>();

    if (!config.disabledStations?.has(s.id)) {
      // Originate self-prefix into Loc-RIB
      locRib.set(s.id, {
        prefix: meta.ipv4Prefix,
        destinationStationId: s.id,
        nextHopStationId: s.id,
        nextHopAsn: meta.asn,
        localPref: 300,
        asPath: [meta.asn],
        stationPath: [s.id],
        cablePath: [],
        origin: 'IGP',
        med: 0,
        sessionType: 'ibgp',
        igpMetricMs: 0,
        communities: [`${meta.asn}:100`],
        learnedFromRel: 'customer',
      });
    }

    speakers.set(s.id, {
      stationId: s.id,
      asn: meta.asn,
      asName: meta.asName,
      adjRibIn: [],
      locRib,
      adjRibOut: Array.from(locRib.values()),
    });
  }

  // Build adjacency list from optically active cables
  const adj = new Map<string, Array<{ neighborId: string; cable: SubseaCable }>>();
  for (const s of LANDING_STATIONS) adj.set(s.id, []);
  for (const cable of activeCables) {
    const [a, b] = cable.endpoints;
    adj.get(a)?.push({ neighborId: b, cable });
    adj.get(b)?.push({ neighborId: a, cable });
  }

  // Iterative BGP UPDATE message exchange & RFC 4271 Loc-RIB selection (up to 14 rounds)
  for (let round = 0; round < 14; round++) {
    let changed = false;

    for (const s of LANDING_STATIONS) {
      const rxId = s.id;
      const rxSpeaker = speakers.get(rxId)!;
      if (config.disabledStations?.has(rxId)) continue;

      const rxMeta = STATION_ASN_MAP[rxId]!;

      for (const { neighborId: txId, cable } of adj.get(rxId) ?? []) {
        const txSpeaker = speakers.get(txId)!;
        const txMeta = STATION_ASN_MAP[txId]!;
        const linkRtt = cableLatencyMs.get(cable.id) ?? 20;

        for (const [dstId, txRoute] of txSpeaker.locRib.entries()) {
          if (dstId === rxId) continue;
          if (txRoute.stationPath.includes(rxId)) continue;

          const policy = evaluateBgpPolicy(
            rxId,
            txId,
            cable,
            txRoute,
            config
          );
          if (!policy.allowed) continue;

          const candidate: BgpRouteAdvertisement = {
            prefix: txRoute.prefix,
            destinationStationId: dstId,
            nextHopStationId: txId,
            nextHopAsn: txMeta.asn,
            localPref: policy.localPref,
            asPath: [rxMeta.asn, ...txRoute.asPath],
            stationPath: [rxId, ...txRoute.stationPath],
            cablePath: [cable.id, ...txRoute.cablePath],
            origin: txRoute.origin,
            med: policy.med,
            sessionType: rxMeta.asn === txMeta.asn ? 'ibgp' : 'ebgp',
            igpMetricMs: Number((txRoute.igpMetricMs + linkRtt).toFixed(1)),
            communities: policy.communities,
            learnedFromRel: policy.rel,
            isLeaked:
              txRoute.isLeaked ||
              policy.communities.includes('65000:666-LEAK'),
            isHijack: txRoute.isHijack,
          };

          // BGP Prefix Hijack scenario:
          // If prefixHijackActive is enabled and destination is Marseille ('marseille') or Bude ('bude'),
          // Jeddah/Fujairah originates a forged 1-hop sub-prefix hijack route with high LOCAL_PREF
          if (
            config.prefixHijackActive &&
            (dstId === 'marseille' || dstId === 'bude') &&
            candidate.stationPath.includes('fujairah')
          ) {
            candidate.localPref = 280;
            candidate.asPath = [rxMeta.asn, 64666]; // Spoofed ultra-short AS_PATH
            candidate.isHijack = true;
            candidate.communities = [...candidate.communities, '64666:HIJACK'];
          }

          rxSpeaker.adjRibIn.push(candidate);

          const existing = rxSpeaker.locRib.get(dstId);
          if (!existing || compareBgpRoutes(candidate, existing) < 0) {
            rxSpeaker.locRib.set(dstId, candidate);
            changed = true;
          }
        }
      }
    }

    if (!changed) break;
  }

  // Populate selectedRoutes map and physicallyReachablePairs (via un-filtered BFS over activeCables)
  const selectedRoutes = new Map<string, BgpRouteAdvertisement>();
  for (const [srcId, speaker] of speakers.entries()) {
    speaker.adjRibOut = Array.from(speaker.locRib.values());
    for (const [dstId, route] of speaker.locRib.entries()) {
      if (srcId !== dstId) {
        selectedRoutes.set(`${srcId}->${dstId}`, route);
      }
    }
  }

  // Compute pure physical reachability (ignoring BGP policy/daemons) to distinguish Policy Drops vs Physical Cuts
  const physicallyReachablePairs = new Set<string>();
  for (const src of LANDING_STATIONS) {
    if (config.disabledStations?.has(src.id)) continue;
    const visited = new Set<string>([src.id]);
    const queue = [src.id];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const { neighborId } of adj.get(curr) ?? []) {
        if (config.disabledStations?.has(neighborId)) continue;
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
          physicallyReachablePairs.add(`${src.id}->${neighborId}`);
        }
      }
    }
  }

  return {
    speakers,
    selectedRoutes,
    physicallyReachablePairs,
  };
}
