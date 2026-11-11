import { LANDING_STATIONS } from './networkData';

const DEG2RAD = Math.PI / 180;

export interface SubseaHazardZone {
  id: string;
  name: string;
  kind: 'anchor' | 'seismic';
  lat: number;
  lon: number;
  radiusDeg: number;
  maxDepthM: number;
  description: string;
}

export const SUBSEA_HAZARD_ZONES: SubseaHazardZone[] = [
  {
    id: 'hz-suez',
    name: 'Red Sea / Bab-el-Mandeb Shipping Lane',
    kind: 'anchor',
    lat: 14.5,
    lon: 42.2,
    radiusDeg: 4.5,
    maxDepthM: 1800,
    description: 'High-density maritime chokepoint; anchor-drag and shallow-shelf snag hazard.',
  },
  {
    id: 'hz-malacca',
    name: 'Strait of Malacca Maritime Corridor',
    kind: 'anchor',
    lat: 3.5,
    lon: 100.2,
    radiusDeg: 4.0,
    maxDepthM: 120,
    description: 'Shallow (<120m) ultra-busy shipping lane; frequent anchor and trawler faults.',
  },
  {
    id: 'hz-channel',
    name: 'Celtic Shelf / Western Approaches',
    kind: 'anchor',
    lat: 49.5,
    lon: -6.5,
    radiusDeg: 4.2,
    maxDepthM: 160,
    description: 'Dense bottom-trawling and vessel anchoring over continental shelf.',
  },
  {
    id: 'hz-luzon',
    name: 'Luzon Strait / Manila Trench',
    kind: 'seismic',
    lat: 20.8,
    lon: 121.0,
    radiusDeg: 5.5,
    maxDepthM: 5400,
    description: 'Subduction zone prone to magnitude 7+ quakes and canyon turbidity currents.',
  },
  {
    id: 'hz-japan',
    name: 'Japan Trench / Sagami Trough',
    kind: 'seismic',
    lat: 34.5,
    lon: 141.5,
    radiusDeg: 5.2,
    maxDepthM: 7200,
    description: 'Active plate boundary with rapid deep-sea slope landslides.',
  },
  {
    id: 'hz-sicily',
    name: 'Strait of Sicily & Ionian Escarpment',
    kind: 'seismic',
    lat: 36.2,
    lon: 15.2,
    radiusDeg: 4.0,
    maxDepthM: 3600,
    description: 'Steep Malta escarpment slope & heavy Mediterranean vessel traffic.',
  },
];

// Major deep-sea trenches [lat, lon, depthAddM, sigmaDeg]
const TRENCHES: Array<[number, number, number, number]> = [
  [13.0, 146.5, 4200, 5.0],   // Mariana Trench
  [20.2, 120.2, 2100, 3.8],   // Manila / Luzon Trench
  [35.5, 143.0, 3400, 5.2],   // Japan Trench
  [-8.5, 108.0, 2900, 5.5],   // Java / Sunda Trench
  [19.5, -66.5, 3400, 4.5],   // Puerto Rico Trench
  [17.5, 39.8, -1100, 3.2],   // Red Sea shallow shelf transition -> axial trough handled below
  [35.5, 22.0, 1400, 4.2],    // Hellenic Trench (Med)
];

// Mid-ocean ridge crests (shallower than abyssal plains) [lat, lon, riseM, sigmaDeg]
const RIDGES: Array<[number, number, number, number]> = [
  [45.0, -28.0, 1800, 8.0],   // North Mid-Atlantic Ridge
  [22.0, -45.0, 1900, 8.5],   // Central Mid-Atlantic Ridge
  [-15.0, -14.0, 1900, 9.0],  // South Mid-Atlantic Ridge
  [-18.0, 66.0, 1600, 8.0],   // Central Indian Ridge
  [-38.0, 48.0, 1500, 8.5],   // Southwest Indian Ridge
  [-10.0, -108.0, 1700, 10.0], // East Pacific Rise
];

function smoothNoise(lat: number, lon: number): number {
  const rLat = lat * DEG2RAD;
  const rLon = lon * DEG2RAD;
  const n1 = Math.sin(rLat * 5.3 + rLon * 3.7) * Math.cos(rLon * 4.1 - rLat * 2.9);
  const n2 = Math.sin(rLat * 11.7 - rLon * 9.3) * 0.5;
  const n3 = Math.cos(rLat * 23.1 + rLon * 19.7) * 0.25;
  return (n1 + n2 + n3) / 1.75; // approx -1..1
}

function angularDistDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = lat1 - lat2;
  let dLon = lon1 - lon2;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return Math.hypot(dLat, dLon * Math.cos(((lat1 + lat2) * 0.5) * DEG2RAD));
}

/**
 * Estimates realistic seabed depth in meters (negative = below sea level, e.g. -4200m)
 * at any ocean coordinate using continental shelf proximity, abyssal plains, trenches, and ridges.
 */
export function sampleSeabedDepthMeters(lat: number, lon: number): number {
  // Nearest continental landing station approximates shelf distance (exclude small oceanic atolls like Guam)
  let minCoastDeg = 999;
  for (const s of LANDING_STATIONS) {
    if (s.id === 'guam') continue;
    const d = angularDistDeg(lat, lon, s.lat, s.lon);
    if (d < minCoastDeg) minCoastDeg = d;
  }

  // Continental shelf (0..3.5 deg from coast) ramps smoothly from -60m down to -4200m abyssal plain
  const shelfFactor = Math.min(1, Math.max(0, (minCoastDeg - 0.5) / 5.5));
  const smoothShelf = shelfFactor * shelfFactor * (3 - 2 * shelfFactor);
  let depth = 65 + smoothShelf * 4350;

  // Shallow semi-enclosed seas (Red Sea, Malacca, Persian Gulf)
  if (lat > 12 && lat < 30 && lon > 32 && lon < 44) {
    // Red Sea axial rift: ~450m near shore up to ~2200m in center
    depth = Math.min(depth, 1100 + Math.abs(smoothNoise(lat, lon)) * 1050);
  }
  if (lat > -2 && lat < 8 && lon > 97 && lon < 105) {
    // Malacca / Sunda shelf
    depth = Math.min(depth, 90 + Math.abs(smoothNoise(lat, lon)) * 75);
  }

  // Add abyssal hills & fracture zone relief
  depth += smoothNoise(lat, lon) * (180 + smoothShelf * 520);

  // Add trenches
  for (const [tLat, tLon, addM, sig] of TRENCHES) {
    const d = angularDistDeg(lat, lon, tLat, tLon);
    if (d < sig * 2.5) {
      depth += addM * Math.exp(-(d * d) / (2 * sig * sig));
    }
  }

  // Subtract mid-ocean ridges
  for (const [rLat, rLon, riseM, sig] of RIDGES) {
    const d = angularDistDeg(lat, lon, rLat, rLon);
    if (d < sig * 2.5) {
      depth -= riseM * Math.exp(-(d * d) / (2 * sig * sig));
    }
  }

  return -Math.round(Math.max(35, Math.min(8900, depth)));
}

/**
 * Converts seabed depth (e.g. -4200m) into radial world-space offset below sea level (R = 10.0).
 * Proportional hydrographic relief scaling so continental shelves, slopes, ridges, and trenches
 * maintain realistic geometric relationships without excessive vertical distortion.
 */
export function depthMetersToWorldOffset(depthMeters: number): number {
  const absM = Math.max(0, -depthMeters);
  return -Math.pow(absM / 8500, 0.85) * 0.46;
}

export function classifyHazardAtCoord(
  lat: number,
  lon: number,
  depthMeters: number
): 'Anchor Drag' | 'Turbidity Landslide' | 'Trawler Snag' | 'PFE Shunt Fault' {
  for (const hz of SUBSEA_HAZARD_ZONES) {
    const d = angularDistDeg(lat, lon, hz.lat, hz.lon);
    if (d <= hz.radiusDeg) {
      return hz.kind === 'anchor' ? 'Anchor Drag' : 'Turbidity Landslide';
    }
  }
  const absDepth = Math.abs(depthMeters);
  if (absDepth <= 180) return 'Trawler Snag';
  if (absDepth <= 1400) return 'Anchor Drag';
  if (absDepth >= 3800) return 'Turbidity Landslide';
  return 'PFE Shunt Fault';
}
