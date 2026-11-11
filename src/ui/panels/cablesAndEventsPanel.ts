import { telemetryAudio } from '../../audio/telemetryAudio';
import { SUBSEA_CABLES } from '../../data/networkData';
import type { GlobeScene, HoverInfo } from '../../globe/GlobeScene';
import { STATION_ASN_MAP } from '../../sim/bgpEngine';
import { escapeHtml, type DomRefs } from '../../app/domRefs';
import type { SimulatorStore } from '../../app/store';

export interface CablesAndEventsController {
  renderCablesList: () => void;
  renderEventsLog: () => void;
  renderTooltip: (info: HoverInfo | null) => void;
}

export function mountCablesAndEventsPanel(
  store: SimulatorStore,
  refs: DomRefs,
  globe: GlobeScene,
  announce: (msg: string) => void
): CablesAndEventsController {
  const renderCablesList = (): void => {
    const query = refs.cableSearchInput.value.trim().toLowerCase();
    refs.cablesList.innerHTML = '';

    const filtered = SUBSEA_CABLES.filter((c) => {
      if (!query) return true;
      return (
        c.name.toLowerCase().includes(query) ||
        c.systemCode.toLowerCase().includes(query) ||
        c.corridorTag.toLowerCase().includes(query) ||
        c.owners.toLowerCase().includes(query)
      );
    });

    filtered.sort((a, b) => {
      const sa = store.currentSnapshot.cables.get(a.id)?.cutState ?? 'active';
      const sb = store.currentSnapshot.cables.get(b.id)?.cutState ?? 'active';
      const weight = (s: string) =>
        s === 'severed' ? 0 : s === 'degraded' ? 1 : s === 'repairing' ? 2 : 3;
      return weight(sa) - weight(sb);
    });

    for (const cable of filtered) {
      const st = store.currentSnapshot.cables.get(cable.id)!;
      const utilPct = Math.min(100, Math.round(st.utilization * 100));
      const card = document.createElement('div');
      card.className = `cable-card ${st.cutState}`;

      const utilClass =
        st.utilization >= 0.9 ? 'over' : st.utilization >= 0.68 ? 'high' : '';

      let statusText = `${utilPct}% (${st.carriedTbps}/${cable.capacityTbps} Tbps) · GSNR ${st.osnrDb}dB · Q ${st.optical.qFactorDb}dB`;
      if (st.cutState === 'severed') {
        statusText = `LOS (${st.faultCause}) @ ${st.faultDistanceKm}±${st.faultUncertaintyKm}km (${Math.abs(
          st.faultDepthM ?? cable.depthMaxM
        )}m)`;
      } else if (st.cutState === 'degraded') {
        statusText = `DEGRADED (${st.faultCause}) · ${st.pfe.mode} · Q=${st.optical.qFactorDb}dB`;
      } else if (st.cutState === 'repairing') {
        statusText = `${st.repairShip} · ${st.repairPlan?.currentStep.code ?? 'REPAIR'} (${
          st.repairPlan?.remainingHours ?? 0
        }h rem)`;
      }

      card.innerHTML = `
        <div class="cable-card-top">
          <div>
            <div class="cable-name">${escapeHtml(cable.name)}</div>
            <div class="cable-meta">${escapeHtml(cable.systemCode)} · RFS ${cable.rfsYear} · ${cable.lengthKm.toLocaleString()} km · ${st.repeaterCount} EDFA · ${st.provenance.routeConfidence}</div>
          </div>
        </div>
        <div class="util-bar" aria-hidden="true">
          <div class="util-fill ${utilClass}" style="inline-size: ${
            st.cutState === 'repairing'
              ? Math.round(st.repairProgress * 100)
              : st.cutState === 'severed'
              ? 0
              : utilPct
          }%"></div>
        </div>
        <div class="cable-card-actions">
          <span class="cable-meta">${escapeHtml(statusText)}</span>
          <div style="display:flex; gap:6px;"></div>
        </div>
      `;

      const actionWrap = card.querySelector('.cable-card-actions > div')!;
      const inspectBtn = document.createElement('button');
      inspectBtn.type = 'button';
      inspectBtn.className = 'cable-action-btn';
      inspectBtn.textContent = 'Inspect';
      inspectBtn.addEventListener('click', () => {
        refs.otdrCableSelect.value = cable.id;
        store.setInspectedCable(cable.id, true);
        globe.setInspectedCable(cable.id);
        const target =
          st.cutCoord ?? cable.waypoints[Math.floor(cable.waypoints.length / 2)];
        globe.diveTo(target[0], target[1]);
      });
      actionWrap.appendChild(inspectBtn);

      if (st.cutState === 'active') {
        const cutBtn = document.createElement('button');
        cutBtn.type = 'button';
        cutBtn.className = 'cable-action-btn cut';
        cutBtn.textContent = 'Fault';
        cutBtn.addEventListener('click', () => {
          store.activeScenarioId = null;
          store.setInspectedCable(cable.id, false);
          refs.otdrCableSelect.value = cable.id;
          store.engine.severCable(cable.id);
          globe.triggerShockwave(cable.id);
          telemetryAudio.playCableCut();
          const mid = cable.waypoints[Math.floor(cable.waypoints.length / 2)];
          globe.diveTo(mid[0], mid[1]);
          store.refreshSnapshot('full');
        });
        actionWrap.appendChild(cutBtn);
      } else if (st.cutState === 'severed' || st.cutState === 'degraded') {
        const shipBtn = document.createElement('button');
        shipBtn.type = 'button';
        shipBtn.className = 'cable-action-btn repair';
        shipBtn.textContent = 'Mobilize Ship';
        shipBtn.addEventListener('click', () => {
          store.setInspectedCable(cable.id, false);
          refs.otdrCableSelect.value = cable.id;
          store.engine.dispatchRepairShip(cable.id);
          telemetryAudio.playRerouteChirp();
          const stNow = store.currentSnapshot.cables.get(cable.id);
          const focusCoord =
            stNow?.cutCoord ??
            cable.waypoints[Math.floor(cable.waypoints.length / 2)];
          globe.flyTo(focusCoord[0], focusCoord[1], 19.5);
          announce(`Repair vessel mobilized for ${cable.name}.`);
          store.refreshSnapshot('full');
        });
        const spliceBtn = document.createElement('button');
        spliceBtn.type = 'button';
        spliceBtn.className = 'cable-action-btn splice';
        spliceBtn.textContent = 'Restore';
        spliceBtn.addEventListener('click', () => {
          store.engine.restoreCable(cable.id);
          telemetryAudio.playRepairSplice();
          store.refreshSnapshot('full');
        });
        actionWrap.appendChild(shipBtn);
        actionWrap.appendChild(spliceBtn);
      } else {
        const spliceBtn = document.createElement('button');
        spliceBtn.type = 'button';
        spliceBtn.className = 'cable-action-btn splice';
        spliceBtn.textContent = 'Complete';
        spliceBtn.addEventListener('click', () => {
          store.engine.restoreCable(cable.id);
          telemetryAudio.playRepairSplice();
          store.refreshSnapshot('full');
        });
        actionWrap.appendChild(spliceBtn);
      }

      refs.cablesList.appendChild(card);
    }
  };

  const renderEventsLog = (): void => {
    refs.eventsList.innerHTML = '';
    const allEvents = store.engine.getEvents();
    const filtered =
      store.activeEventFilter === 'All'
        ? allEvents
        : allEvents.filter((evt) => evt.subsystem === store.activeEventFilter);

    if (filtered.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'event-item info';
      emptyLi.textContent = `No ${store.activeEventFilter} telemetry events recorded yet.`;
      refs.eventsList.appendChild(emptyLi);
      return;
    }

    for (const evt of filtered) {
      const li = document.createElement('li');
      li.className = `event-item ${evt.severity}`;
      li.innerHTML = `
        <div class="event-head">
          <span class="event-code">${escapeHtml(evt.code)}</span>
          <span class="event-meta-row">
            <span class="event-subsystem-badge">${escapeHtml(evt.subsystem)}</span>
            <span class="event-rel-time">${escapeHtml(evt.relativeTime)}</span>
            <span>${escapeHtml(evt.timestamp)}</span>
          </span>
        </div>
        <div class="event-msg">${escapeHtml(evt.message)}</div>
      `;
      refs.eventsList.appendChild(li);
    }
  };

  const renderTooltip = (info: HoverInfo | null): void => {
    if (!info) {
      refs.tooltipEl.hidden = true;
      return;
    }

    if (info.kind === 'station' && info.station) {
      const s = info.station;
      const asMeta = STATION_ASN_MAP[s.id];
      refs.tooltipEl.innerHTML = `
        <div class="tooltip-title">${escapeHtml(s.name)} (AS${asMeta?.asn ?? 65000})</div>
        <div class="tooltip-sub">${escapeHtml(s.city)}, ${escapeHtml(s.country)} · ${escapeHtml(asMeta?.asName ?? '')}</div>
        <div class="tooltip-meta">Prefix: ${escapeHtml(asMeta?.ipv4Prefix ?? '')} · IXPs: ${escapeHtml(s.ixps.join(', '))}</div>
        <div class="tooltip-hint">Click to set BGP inspection ${
          store.nextStationTarget === 'src' ? 'origin' : 'destination'
        }</div>
      `;
    } else if (info.kind === 'cable' && info.cable && info.runtime) {
      const c = info.cable;
      const r = info.runtime;
      const depthLabel =
        info.depthM && info.depthM < 0
          ? `Bathymetry ${Math.abs(info.depthM).toLocaleString()}m (Est.)`
          : 'Terrestrial Conduit';
      const statusLine =
        r.cutState === 'severed'
          ? `OPTICAL LOS (${r.faultCause}) · Est. ${r.faultDistanceKm}±${r.faultUncertaintyKm} km`
          : r.cutState === 'degraded'
          ? `DEGRADED (${r.faultCause}) · PFE ${r.pfe.mode} · Q=${r.optical.qFactorDb} dB`
          : r.cutState === 'repairing'
          ? `${r.repairShip} · ${r.repairPlan?.currentStep.code ?? 'REPAIR'} (${
              r.repairPlan?.remainingHours ?? 0
            }h rem)`
          : `Load ${Math.round(r.utilization * 100)}% (${r.carriedTbps}/${
              c.capacityTbps
            } Tbps) · GSNR ${r.osnrDb}dB · Q ${r.optical.qFactorDb}dB`;

      refs.tooltipEl.innerHTML = `
        <div class="tooltip-title">${escapeHtml(c.name)}</div>
        <div class="tooltip-sub">${escapeHtml(c.systemCode)} · ${c.lengthKm.toLocaleString()} km · ${depthLabel}</div>
        <div class="tooltip-meta">${escapeHtml(statusLine)}</div>
        <div class="tooltip-meta">Provenance: ${r.provenance.routeConfidence} (${escapeHtml(c.owners)})</div>
      `;
    }

    refs.tooltipEl.hidden = false;
    const pad = 16;
    const rect = refs.tooltipEl.getBoundingClientRect();
    const left = Math.min(window.innerWidth - rect.width - pad, info.x + 14);
    const top = Math.min(window.innerHeight - rect.height - pad, info.y + 14);
    refs.tooltipEl.style.left = `${Math.max(pad, left)}px`;
    refs.tooltipEl.style.top = `${Math.max(pad, top)}px`;
  };

  store.on('snapshot', () => {
    renderCablesList();
    renderEventsLog();
  });
  store.on('repairTick', renderCablesList);
  store.on('eventsFilter', renderEventsLog);

  return { renderCablesList, renderEventsLog, renderTooltip };
}
