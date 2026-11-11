import { SUBSEA_CABLES } from '../../data/networkData';
import type { GlobeScene } from '../../globe/GlobeScene';
import { STATION_ASN_MAP } from '../../sim/bgpEngine';
import { escapeHtml, type DomRefs } from '../../app/domRefs';
import type { SimulatorStore } from '../../app/store';

export function mountBgpInspectorPanel(
  store: SimulatorStore,
  refs: DomRefs,
  globe: GlobeScene
): () => void {
  const renderTraceroute = (): void => {
    const trace = store.currentSnapshot.customTrace;
    if (!trace) {
      refs.traceStatusBadge.textContent = 'SELECT';
      refs.traceStatusBadge.className = 'badge badge-optimal';
      refs.traceRttEl.textContent = '-- ms';
      refs.traceDeltaEl.textContent = '--';
      refs.traceLossEl.textContent = '--';
      refs.bgpRibBox.textContent =
        'Select distinct origin and destination CLS hubs.';
      refs.traceHopsChain.textContent = '';
      return;
    }

    refs.traceStatusBadge.textContent = trace.status;
    refs.traceStatusBadge.className = `badge badge-${trace.status.toLowerCase()}`;

    const srcMeta = STATION_ASN_MAP[trace.srcId];
    const dstMeta = STATION_ASN_MAP[trace.dstId];

    if (trace.status === 'POLICY_BLOCKED') {
      refs.traceRttEl.textContent = 'FILTERED';
      refs.traceDeltaEl.textContent = 'NO_EXPORT';
      refs.traceLossEl.textContent = '100% / --';
      refs.bgpRibBox.textContent =
        'RFC 4271 Loc-RIB: NONE | Physical Path: ACTIVE | Rejected by AS37457 NO_EXPORT / Valley-Free export filter.';
      refs.traceHopsChain.textContent = `Physical capacity exists between AS${srcMeta?.asn} and AS${dstMeta?.asn}, but BGP policy filtered all candidate advertisements.`;
      return;
    }

    if (trace.status === 'PARTITIONED' || !trace.bgpRoute) {
      refs.traceRttEl.textContent = 'WITHDRAWN';
      refs.traceDeltaEl.textContent = 'LOS';
      refs.traceLossEl.textContent = '100% / --';
      refs.bgpRibBox.textContent = `RFC 4271 Loc-RIB: Route withdrawn (${dstMeta?.ipv4Prefix ?? ''}). Physical & BGP reachability lost.`;
      refs.traceHopsChain.textContent =
        'All optical trunks or border router sessions on candidate paths are down.';
      return;
    }

    const delta = trace.currentRttMs - trace.baselineRttMs;
    refs.traceRttEl.textContent = `${trace.currentRttMs.toFixed(1)} ms`;
    refs.traceDeltaEl.textContent =
      delta > 0.1 ? `+${delta.toFixed(1)} ms` : '0.0 ms';
    refs.traceLossEl.textContent = `${trace.packetLossPct}% / ${trace.jitterMs}ms`;

    const r = trace.bgpRoute;
    const asPathStr = r.asPath.map((asn) => `AS${asn}`).join(' ');
    const commStr = r.communities.join(' ');
    refs.bgpRibBox.textContent = `Prefix ${r.prefix} | LOCAL_PREF ${r.localPref} | MED ${r.med} | AS_PATH [${asPathStr}] | Comm: ${commStr}`;

    const pathLabels = trace.currentPath.map(
      (id) => store.stationById.get(id)?.city ?? id
    );
    const cableCodes = trace.currentCables.map(
      (id) => SUBSEA_CABLES.find((c) => c.id === id)?.systemCode ?? id
    );

    const segments: string[] = [];
    for (let i = 0; i < pathLabels.length; i++) {
      segments.push(pathLabels[i]);
      if (i < cableCodes.length) {
        segments.push(`[${cableCodes[i]}]`);
      }
    }
    refs.traceHopsChain.textContent = `FIB Data Plane: ${segments.join(' -> ')}`;
  };

  const renderCorridorsTable = (): void => {
    refs.corridorsTbody.innerHTML = '';
    for (const c of store.currentSnapshot.corridors) {
      const tr = document.createElement('tr');
      const isImpacted = c.status !== 'OPTIMAL';
      tr.className = `corridor-row ${
        isImpacted ? 'is-impacted' : 'is-unchanged'
      } ${store.selectedCorridorId === c.id ? 'selected' : ''}`;
      tr.tabIndex = 0;

      const delta = c.currentRttMs - c.baselineRttMs;
      const liveCell =
        c.status === 'PARTITIONED' || c.status === 'POLICY_BLOCKED'
          ? `<span class="delta-bad">${c.status === 'POLICY_BLOCKED' ? 'POLICY' : 'DOWN'}</span>`
          : `${c.currentRttMs.toFixed(1)} ms${
              delta > 0.3
                ? `<span class="${delta > 40 ? 'delta-bad' : 'delta-up'}">+${delta.toFixed(0)}</span>`
                : ''
            }`;

      tr.innerHTML = `
        <th scope="row">${escapeHtml(c.label)}</th>
        <td class="mono-cell">${c.baselineRttMs.toFixed(1)} ms</td>
        <td class="mono-cell">${liveCell}</td>
        <td><span class="badge badge-${c.status.toLowerCase()}">${c.status}</span></td>
      `;

      const selectCorridor = () => {
        refs.traceSrcSelect.value = c.srcId;
        refs.traceDstSelect.value = c.dstId;
        if (c.currentCables.length > 0) {
          store.setInspectedCable(c.currentCables[0], false);
          refs.otdrCableSelect.value = c.currentCables[0];
        }
        store.setTraceEndpoints(c.srcId, c.dstId, c.id);
        const src = store.stationById.get(c.srcId);
        const dst = store.stationById.get(c.dstId);
        if (src && dst) {
          globe.flyTo((src.lat + dst.lat) / 2, (src.lon + dst.lon) / 2, 24);
        }
      };

      tr.addEventListener('click', selectCorridor);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectCorridor();
        }
      });

      refs.corridorsTbody.appendChild(tr);
    }
  };

  const renderAll = (): void => {
    renderTraceroute();
    renderCorridorsTable();
  };

  store.on('snapshot', renderAll);
  store.on('selection', renderAll);
  store.on('repairTick', renderAll);

  return renderAll;
}

