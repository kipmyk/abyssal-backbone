import {
  GLOSSARY_ENTRIES,
  INLINE_TERM_HINTS,
  MODEL_ASSUMPTIONS,
} from '../data/glossary';
import { SUBSEA_CABLES } from '../data/networkData';
import { getCableProvenance } from '../data/provenance';
import { escapeHtml, type DomRefs } from '../app/domRefs';
import type { SimulatorStore } from '../app/store';

export interface DialogsController {
  openGuideDialog: () => void;
  openAboutCableDialog: (cableId: string) => void;
  renderGlossary: (filterQuery?: string) => void;
}

function populateTermHints(): void {
  const hintMap: Record<string, string> = {
    'hint-bgp': 'bgp',
    'hint-cls': 'cls',
    'hint-gsnr': 'gsnr',
    'hint-qfactor': 'qfactor',
    'hint-pfe': 'pfe',
  };
  for (const [elId, hintKey] of Object.entries(hintMap)) {
    const el = document.getElementById(elId);
    const data = INLINE_TERM_HINTS[hintKey];
    if (!el || !data) continue;
    el.innerHTML = `<h4>${escapeHtml(data.title)}</h4><p>${escapeHtml(data.body)}</p>`;
  }
}

function renderAssumptions(refs: DomRefs): void {
  const markup = MODEL_ASSUMPTIONS.map(
    (group) => `
      <div class="assumption-group">
        <h4>${escapeHtml(group.title)}</h4>
        <ul>${group.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>`
  ).join('');

  refs.dialogAssumptionsList.innerHTML = markup;
  refs.inlineAssumptionsBody.innerHTML = markup;
}

function setupDialogBackdropFallbacks(dialogs: HTMLDialogElement[]): void {
  for (const dlg of dialogs) {
    if ('closedBy' in HTMLDialogElement.prototype) continue;
    let pointerStartedOutside = false;
    dlg.addEventListener('pointerdown', (e) => {
      if (e.target !== dlg) {
        pointerStartedOutside = false;
        return;
      }
      const rect = dlg.getBoundingClientRect();
      pointerStartedOutside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;
    });
    dlg.addEventListener('pointerup', (e) => {
      if (!pointerStartedOutside || e.target !== dlg) return;
      const rect = dlg.getBoundingClientRect();
      const outside =
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom;
      if (outside) dlg.close();
      pointerStartedOutside = false;
    });
  }
}

function setupToggletipSync(): void {
  document.addEventListener(
    'toggle',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.id) return;
      const invoker = document.querySelector<HTMLButtonElement>(
        `[popovertarget="${target.id}"]`
      );
      if (!invoker) return;
      invoker.setAttribute(
        'aria-expanded',
        String((e as ToggleEvent).newState === 'open')
      );
    },
    true
  );
}

/**
 * Initializes native `<dialog>` overlays (Guide/Glossary, About Cable System),
 * inline `popover="hint"` toggletips, and Model Assumptions disclosures.
 */
export function initDialogsAndHints(
  store: SimulatorStore,
  refs: DomRefs
): DialogsController {
  const renderGlossary = (filterQuery = ''): void => {
    const q = filterQuery.trim().toLowerCase();
    refs.glossaryDl.innerHTML = '';
    const filtered = GLOSSARY_ENTRIES.filter((entry) => {
      if (!q) return true;
      return (
        entry.term.toLowerCase().includes(q) ||
        entry.shortLabel.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        entry.definition.toLowerCase().includes(q)
      );
    });

    if (filtered.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'glossary-item';
      emptyDiv.textContent = 'No matching glossary entries found.';
      refs.glossaryDl.appendChild(emptyDiv);
      return;
    }

    for (const entry of filtered) {
      const wrapper = document.createElement('div');
      wrapper.className = 'glossary-item';
      wrapper.innerHTML = `
        <dt>${escapeHtml(entry.shortLabel)} <span class="glossary-cat">${escapeHtml(entry.category)}</span></dt>
        <dd>${escapeHtml(entry.definition)}</dd>
      `;
      refs.glossaryDl.appendChild(wrapper);
    }
  };

  const openGuideDialog = (): void => {
    renderGlossary(refs.glossaryFilterInput.value);
    if (typeof refs.guideDialog.showModal === 'function') {
      refs.guideDialog.showModal();
    }
  };

  const openAboutCableDialog = (cableId: string): void => {
    const cable = SUBSEA_CABLES.find((c) => c.id === cableId);
    if (!cable) return;
    const prov = getCableProvenance(cable);
    const st = store.currentSnapshot.cables.get(cable.id);
    const endpoints = `${store.stationById.get(cable.endpoints[0])?.city ?? cable.endpoints[0]} <-> ${store.stationById.get(cable.endpoints[1])?.city ?? cable.endpoints[1]}`;

    refs.aboutCableBody.innerHTML = `
      <div class="about-spec-grid">
        <div class="about-spec-cell">
          <span class="about-spec-label">System Name / Code</span>
          <span class="about-spec-value">${escapeHtml(cable.name)} (${escapeHtml(cable.systemCode)})</span>
        </div>
        <div class="about-spec-cell">
          <span class="about-spec-label">Route Endpoints</span>
          <span class="about-spec-value">${escapeHtml(endpoints)}</span>
        </div>
        <div class="about-spec-cell">
          <span class="about-spec-label">Route Length</span>
          <span class="about-spec-value">${cable.lengthKm.toLocaleString()} km (${cable.waypoints.length} plotted vertices)</span>
        </div>
        <div class="about-spec-cell">
          <span class="about-spec-label">Ready for Service (RFS)</span>
          <span class="about-spec-value">${cable.rfsYear}</span>
        </div>
        <div class="about-spec-cell">
          <span class="about-spec-label">Design Capacity / Pairs</span>
          <span class="about-spec-value">${cable.capacityTbps} Tbps · ${prov.fiberPairs} Fiber Pairs</span>
        </div>
        <div class="about-spec-cell">
          <span class="about-spec-label">Branching &amp; Zone</span>
          <span class="about-spec-value">${prov.branchingUnits.length} BU · ${escapeHtml(prov.maintenanceZone)}</span>
        </div>
      </div>
      <div class="assumption-group">
        <h4>Owners / Consortium &amp; Provenance</h4>
        <ul>
          <li><strong>Owners:</strong> ${escapeHtml(cable.owners)}</li>
          <li><strong>Corridor / Fiber Spec:</strong> ${escapeHtml(cable.corridorTag)} · ${escapeHtml(st?.optical.fiberStandard ?? 'ITU-T G.654.E / G.652.D')} (Route: ${escapeHtml(prov.routeConfidence)}, Cap: ${escapeHtml(prov.capacityConfidence)})</li>
          <li><strong>Citation:</strong> ${escapeHtml(prov.sourceCitation)} (${escapeHtml(prov.sourceDate)})</li>
          <li><strong>Branching Units:</strong> ${prov.branchingUnits.length > 0 ? escapeHtml(prov.branchingUnits.map((b) => `${b.name} (${b.opticalRouting})`).join(', ')) : 'Point-to-point trunk (no subsea BU)'}</li>
        </ul>
      </div>
      <p class="disclaimer-callout">
        Educational system summary derived from public ITU/TeleGeography/operator disclosures. Synthetic telemetry parameters are approximations.
      </p>
    `;

    if (typeof refs.aboutCableDialog.showModal === 'function') {
      refs.aboutCableDialog.showModal();
    }
  };

  populateTermHints();
  renderAssumptions(refs);
  renderGlossary();
  setupDialogBackdropFallbacks([refs.guideDialog, refs.aboutCableDialog]);
  setupToggletipSync();

  return {
    openGuideDialog,
    openAboutCableDialog,
    renderGlossary,
  };
}
