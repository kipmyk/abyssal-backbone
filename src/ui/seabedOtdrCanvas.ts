import { sampleCableEngineeringAtPoint } from '../data/provenance';
import type { CableRuntimeState, SubseaCable } from '../types/network';

function interpolateLatLon(
  waypoints: [number, number][],
  t: number
): [number, number] {
  if (waypoints.length === 0) return [0, 0];
  if (waypoints.length === 1) return waypoints[0];
  const scaled = Math.max(0, Math.min(1, t)) * (waypoints.length - 1);
  const idx = Math.min(waypoints.length - 2, Math.floor(scaled));
  const localT = scaled - idx;
  const [lat1, lon1] = waypoints[idx];
  const [lat2, lon2] = waypoints[idx + 1];
  return [lat1 + (lat2 - lat1) * localT, lon1 + (lon2 - lon1) * localT];
}

export function renderSeabedAndOtdr(
  canvas: HTMLCanvasElement,
  cable: SubseaCable,
  runtime: CableRuntimeState
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 350;
  const h = canvas.clientHeight || 275;
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const padL = 40;
  const padR = 10;
  const plotW = w - padL - padR;

  const seaTop = 18;
  const seaHeight = Math.round(h * 0.42);
  const seaBottom = seaTop + seaHeight;

  const otdrTop = seaBottom + 26;
  const otdrHeight = h - otdrTop - 18;
  const otdrBottom = otdrTop + otdrHeight;

  // --- 1. HYDROGRAPHIC BATHYMETRY & ARMOR/BURIAL PROFILE ---
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(
    `BATHYMETRY & ARMOR PROFILE · ${runtime.provenance.routeConfidence}`,
    padL,
    12
  );

  // Instrument grid box
  ctx.fillStyle = '#050b16';
  ctx.fillRect(padL, seaTop, plotW, seaHeight);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, seaTop, plotW, seaHeight);

  const samples = 64;
  const engSamples = [];
  let maxAbsDepth = 1500;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const [lat, lon] = interpolateLatLon(cable.waypoints, t);
    const sample = sampleCableEngineeringAtPoint(cable, lat, lon);
    engSamples.push(sample);
    if (-sample.depthM > maxAbsDepth) maxAbsDepth = -sample.depthM;
  }
  maxAbsDepth = Math.ceil(maxAbsDepth / 1000) * 1000;

  // Horizontal depth graticules
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.fillStyle = '#64748b';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  for (let frac = 0; frac <= 1; frac += 0.5) {
    const y = seaTop + frac * seaHeight;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    const label = frac === 0 ? '0m' : `-${Math.round(frac * maxAbsDepth)}m`;
    ctx.fillText(label, 2, y + 3);
  }

  // Seabed polygon fill
  ctx.beginPath();
  ctx.moveTo(padL, seaBottom);
  for (let i = 0; i <= samples; i++) {
    const x = padL + (i / samples) * plotW;
    const y = seaTop + (-engSamples[i].depthM / maxAbsDepth) * (seaHeight - 8);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(padL + plotW, seaBottom);
  ctx.closePath();
  ctx.fillStyle = '#0d192b';
  ctx.fill();

  // Draw cable segment by armor & burial state:
  // Buried shelf segments are drawn slightly below the seabed contour in dashed cyan/amber;
  // Surface-laid deep-water LW segments rest directly on the seabed contour.
  for (let i = 0; i < samples; i++) {
    const x1 = padL + (i / samples) * plotW;
    const x2 = padL + ((i + 1) / samples) * plotW;
    const s1 = engSamples[i];
    const s2 = engSamples[i + 1];
    const burialOffset1 = s1.actualBurialDepthM > 0.3 ? 2.5 : -1.0;
    const burialOffset2 = s2.actualBurialDepthM > 0.3 ? 2.5 : -1.0;
    const y1 =
      seaTop + (-s1.depthM / maxAbsDepth) * (seaHeight - 8) + burialOffset1;
    const y2 =
      seaTop + (-s2.depthM / maxAbsDepth) * (seaHeight - 8) + burialOffset2;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (runtime.cutState === 'severed') {
      ctx.strokeStyle = '#ef4444';
    } else if (runtime.cutState === 'degraded' || runtime.cutState === 'repairing') {
      ctx.strokeStyle = '#f59e0b';
    } else {
      ctx.strokeStyle =
        s1.armorClass === 'DA'
          ? '#fde047'
          : s1.armorClass === 'SA'
          ? '#38bdf8'
          : '#22d3ee';
    }
    ctx.lineWidth = s1.armorClass === 'DA' ? 2.4 : 1.7;
    ctx.stroke();
  }

  // Draw EDFA optical repeaters
  const visualPods = Math.min(16, runtime.repeaterCount);
  for (let p = 1; p <= visualPods; p++) {
    const t = p / (visualPods + 1);
    const idx = Math.round(t * samples);
    const x = padL + t * plotW;
    const y =
      seaTop + (-engSamples[idx].depthM / maxAbsDepth) * (seaHeight - 8) - 1.5;
    ctx.fillStyle =
      runtime.cutState === 'active'
        ? '#10b981'
        : runtime.cutState === 'degraded'
        ? '#f59e0b'
        : '#991b1b';
    ctx.fillRect(x - 1.5, y - 2.5, 3, 5);
  }

  // Draw Fault Marker + Uncertainty Window + Surface Repair Ship
  if (runtime.subsystemFaultMode !== 'none') {
    const ft = runtime.cutProgressT;
    const fx = padL + ft * plotW;
    const fIdx = Math.round(ft * samples);
    const fy =
      seaTop + (-engSamples[fIdx].depthM / maxAbsDepth) * (seaHeight - 8) - 1;

    if (runtime.cutState === 'repairing') {
      ctx.strokeStyle = '#f59e0b';
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(fx, seaTop);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(fx - 6, seaTop - 3, 12, 3);
    }

    ctx.fillStyle = runtime.cutState === 'degraded' ? '#f59e0b' : '#ef4444';
    ctx.beginPath();
    ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- 2. C-OTDR / LME SUPERVISORY TRACE INSTRUMENT (dB vs km) ---
  const otdr = runtime.otdr;
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(
    `${otdr.instrumentMode.toUpperCase()} (${otdr.wavelengthNm}nm · α=${otdr.fiberAttenuationDbKm}dB/km)`,
    padL,
    otdrTop - 6
  );

  ctx.fillStyle = '#050b16';
  ctx.fillRect(padL, otdrTop, plotW, otdrHeight);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.strokeRect(padL, otdrTop, plotW, otdrHeight);

  // dB gridlines (0 dB top to -30 dB bottom)
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
  ctx.fillStyle = '#64748b';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  for (const dbVal of [0, -10, -20, -30]) {
    const norm = Math.abs(dbVal) / 30;
    const y = otdrTop + norm * otdrHeight;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(`${dbVal}dB`, 2, y + 3);
  }

  ctx.fillText('0 km', padL, h - 4);
  ctx.fillText(
    `Span ${otdr.repeaterSpacingKm}km`,
    padL + plotW * 0.38,
    h - 4
  );
  ctx.fillText(`${cable.lengthKm} km`, padL + plotW - 46, h - 4);

  // If fault localized, render the physical measurement uncertainty band [x_est - Δx, x_est + Δx]
  if (
    otdr.estimatedFaultDistanceKm !== null &&
    otdr.uncertaintyPlusMinusKm !== null
  ) {
    const estT = otdr.estimatedFaultDistanceKm / cable.lengthKm;
    const uncT = Math.max(
      0.012,
      otdr.uncertaintyPlusMinusKm / cable.lengthKm
    );
    const xLeft = padL + Math.max(0, estT - uncT) * plotW;
    const xRight = padL + Math.min(1, estT + uncT) * plotW;
    const xCenter = padL + estT * plotW;

    ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
    ctx.fillRect(xLeft, otdrTop + 1, Math.max(3, xRight - xLeft), otdrHeight - 2);

    ctx.strokeStyle = 'rgba(248, 113, 113, 0.75)';
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.moveTo(xCenter, otdrTop);
    ctx.lineTo(xCenter, otdrBottom);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Plot physical trace samples from computeOtdrAnalysis
  ctx.beginPath();
  const trace = otdr.traceSamples;
  for (let i = 0; i < trace.length; i++) {
    const pt = trace[i];
    const x = padL + (pt.km / cable.lengthKm) * plotW;
    // Map +2 dB .. -30 dB into [otdrTop + 4, otdrBottom - 3]
    const norm = Math.max(0, Math.min(1, (2 - pt.levelDb) / 32));
    const y = otdrTop + 4 + norm * (otdrHeight - 7);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle =
    runtime.cutState === 'active'
      ? '#10b981'
      : runtime.cutState === 'degraded'
      ? '#f59e0b'
      : '#f87171';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}
