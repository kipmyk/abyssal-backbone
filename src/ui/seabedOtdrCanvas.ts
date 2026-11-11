import { sampleSeabedDepthMeters } from '../data/bathymetry';
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
  const w = canvas.clientWidth || 340;
  const h = canvas.clientHeight || 260;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, w, h);

  // Split canvas: top 54% Seabed Profile, bottom 46% OTDR Trace
  const padL = 38;
  const padR = 12;
  const plotW = w - padL - padR;

  const seaTop = 18;
  const seaHeight = Math.round(h * 0.46);
  const seaBottom = seaTop + seaHeight;

  const otdrTop = seaBottom + 24;
  const otdrHeight = h - otdrTop - 20;
  const otdrBottom = otdrTop + otdrHeight;

  // --- 1. SEABED BATHYMETRY CROSS-SECTION ---
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('SEABED PROFILE (m)', padL, 12);

  // Water column gradient
  const waterGrad = ctx.createLinearGradient(0, seaTop, 0, seaBottom);
  waterGrad.addColorStop(0, 'rgba(14, 165, 233, 0.22)');
  waterGrad.addColorStop(0.6, 'rgba(7, 45, 86, 0.35)');
  waterGrad.addColorStop(1, 'rgba(2, 6, 17, 0.85)');
  ctx.fillStyle = waterGrad;
  ctx.fillRect(padL, seaTop, plotW, seaHeight);

  // Sample 64 depth points along cable waypoints
  const samples = 64;
  const depths: number[] = [];
  let maxAbsDepth = 1500;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const [lat, lon] = interpolateLatLon(cable.waypoints, t);
    const d = cable.isTerrestrial ? 0 : sampleSeabedDepthMeters(lat, lon);
    depths.push(d);
    if (-d > maxAbsDepth) maxAbsDepth = -d;
  }
  maxAbsDepth = Math.ceil(maxAbsDepth / 1000) * 1000;

  // Depth gridlines
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#64748b';
  ctx.font = '10px ui-monospace, Menlo, monospace';
  for (let frac = 0; frac <= 1; frac += 0.5) {
    const y = seaTop + frac * seaHeight;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    const label = frac === 0 ? '0m' : `-${Math.round(frac * maxAbsDepth)}`;
    ctx.fillText(label, 2, y + 3);
  }

  // Sea surface line
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padL, seaTop);
  ctx.lineTo(padL + plotW, seaTop);
  ctx.stroke();

  // Seabed terrain polygon
  ctx.beginPath();
  ctx.moveTo(padL, seaBottom);
  for (let i = 0; i <= samples; i++) {
    const x = padL + (i / samples) * plotW;
    const y = seaTop + (-depths[i] / maxAbsDepth) * (seaHeight - 6);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(padL + plotW, seaBottom);
  ctx.closePath();
  ctx.fillStyle = '#0c192c';
  ctx.fill();

  // Cable line resting along seabed
  ctx.beginPath();
  for (let i = 0; i <= samples; i++) {
    const x = padL + (i / samples) * plotW;
    const y = seaTop + (-depths[i] / maxAbsDepth) * (seaHeight - 6) - 1.5;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle =
    runtime.cutState === 'active'
      ? '#22d3ee'
      : runtime.cutState === 'repairing'
      ? '#f59e0b'
      : '#ef4444';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw EDFA optical repeaters along seabed
  const visualPods = Math.min(14, runtime.repeaterCount);
  for (let p = 1; p <= visualPods; p++) {
    const t = p / (visualPods + 1);
    const idx = Math.round(t * samples);
    const x = padL + t * plotW;
    const y = seaTop + (-depths[idx] / maxAbsDepth) * (seaHeight - 6) - 1.5;
    ctx.fillStyle =
      runtime.cutState === 'active'
        ? '#34d399'
        : runtime.cutState === 'repairing' && t < runtime.cutProgressT
        ? '#fbbf24'
        : '#7f1d1d';
    ctx.fillRect(x - 2, y - 3, 4, 6);
  }

  // Draw Fault + Surface Ship + ROV Tether if severed/repairing
  if (runtime.cutState !== 'active') {
    const ft = runtime.cutProgressT;
    const fx = padL + ft * plotW;
    const fIdx = Math.round(ft * samples);
    const fy = seaTop + (-depths[fIdx] / maxAbsDepth) * (seaHeight - 6) - 2;

    if (runtime.cutState === 'repairing') {
      // Ship on surface + ROV tether down to seabed
      ctx.strokeStyle = '#fbbf24';
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(fx, seaTop);
      ctx.lineTo(fx, fy);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ship hull on surface
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(fx - 7, seaTop - 4, 14, 4);

      // ROV pod
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(fx, fy - 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(fx, fy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- 2. OTDR OPTICAL BACKSCATTER TRACE (dB vs km) ---
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText(
    `OTDR TRACE · ${cable.lengthKm.toLocaleString()} km · PFE ±${runtime.pfeVoltageKv} kV`,
    padL,
    otdrTop - 6
  );

  ctx.fillStyle = 'rgba(2, 6, 17, 0.72)';
  ctx.fillRect(padL, otdrTop, plotW, otdrHeight);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.strokeRect(padL, otdrTop, plotW, otdrHeight);

  // Axis labels
  ctx.fillStyle = '#64748b';
  ctx.fillText('0 dB', 2, otdrTop + 9);
  ctx.fillText('-30', 2, otdrBottom - 2);
  ctx.fillText('0 km', padL, h - 4);
  ctx.fillText(
    `${cable.lengthKm} km`,
    padL + plotW - 44,
    h - 4
  );

  // Draw OTDR Rayleigh backscatter trace
  ctx.beginPath();
  const breakT = runtime.cutState === 'active' ? 1.05 : runtime.cutProgressT;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const x = padL + t * plotW;

    let levelNorm: number; // 0 = top (0dB), 1 = noise floor (-30dB)
    if (t < breakT) {
      // Sawtooth EDFA repeater gain profile along silica fiber
      const spanSaw = ((t * Math.max(2, visualPods)) % 1) * 0.22;
      const noise = Math.sin(i * 1.9) * 0.015;
      levelNorm = 0.14 + spanSaw + t * 0.12 + noise;
    } else if (Math.abs(t - breakT) <= 0.02) {
      // Fresnel reflection spike right at glass break!
      levelNorm = 0.04;
    } else {
      // Dead noise floor past break
      levelNorm = 0.88 + Math.sin(i * 3.7) * 0.04;
    }

    const y = otdrTop + levelNorm * (otdrHeight - 4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = runtime.cutState === 'active' ? '#34d399' : '#f87171';
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

