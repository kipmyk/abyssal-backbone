import type { DomRefs } from './domRefs';
import type { DensityMode, SimulatorStore, ViewMode } from './store';

const TOUR_STORAGE_KEY = 'abyssal-tour-dismissed-v1';

export interface TourDependencies {
  store: SimulatorStore;
  refs: DomRefs;
  openGlossaryDialog: () => void;
  setViewMode: (mode: ViewMode) => void;
  setDensityMode: (mode: DensityMode) => void;
  announce: (msg: string) => void;
}

interface TourStep {
  title: string;
  body: string;
  actionLabel: string;
  runAction: () => void;
}

/**
 * Controls the opt-in interactive 4-step walkthrough banner.
 * Remains hidden on initial page load and opens on demand from the Guide modal.
 */
export function setupOnboardingTour(deps: TourDependencies): void {
  const { store, refs, openGlossaryDialog, setViewMode, setDensityMode, announce } =
    deps;

  const TOUR_STEPS: TourStep[] = [
    {
      title: 'Explore the Three 3D Viewports',
      body: 'Switch between Split (Globe + Seabed ROV), 3D Seafloor cutaway, and Hydrographic Globe in the top bar. Press F anytime for Focus Mode.',
      actionLabel: 'Preview Globe View',
      runAction: () =>
        setViewMode(store.viewMode === 'globe' ? 'split' : 'globe'),
    },
    {
      title: 'Inspect BGP-4 Paths & Detours',
      body: 'Click two Cable Landing Stations on the globe (or pick Origin/Destination in the left dock) to inspect live AS_PATH, LOCAL_PREF, MED, and policy filters.',
      actionLabel: 'Trace Mombasa -> Marseille',
      runAction: () => {
        refs.traceSrcSelect.value = 'mombasa';
        refs.traceDstSelect.value = 'marseille';
        store.setTraceEndpoints('mombasa', 'marseille', 'mba-mrs');
      },
    },
    {
      title: 'Simulate Real-World Cuts & Compare Impact',
      body: 'Trigger the 2024 Red Sea Multi-Cable Cut or use Fault / Repair click mode on any trunk, then review Before/After capacity, RTT, and BGP diff deltas.',
      actionLabel: 'Simulate Red Sea Cut',
      runAction: () => {
        const redSeaBtn = refs.scenarioList.querySelector<HTMLButtonElement>(
          '[data-scenario-id="red-sea-blackout"]'
        );
        redSeaBtn?.click();
      },
    },
    {
      title: 'Switch Density or Open Engineering Glossary',
      body: 'Toggle Simplified mode for essential KPIs & active path, or Engineering mode for full ITU-T G.977 optical budgets, PFE voltages, and C-OTDR traces.',
      actionLabel: 'Toggle Simplified / Eng',
      runAction: () =>
        setDensityMode(
          store.densityMode === 'engineering' ? 'simplified' : 'engineering'
        ),
    },
  ];

  let stepIdx = 0;

  const renderStep = () => {
    const step = TOUR_STEPS[stepIdx];
    refs.tourStepBadge.textContent = `TOUR · ${stepIdx + 1} / ${TOUR_STEPS.length}`;
    refs.tourStepTitle.textContent = step.title;
    refs.tourStepBody.textContent = step.body;
    refs.btnTourAction.textContent = step.actionLabel;
    refs.btnTourNext.textContent =
      stepIdx === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
  };

  const dismissTour = () => {
    refs.onboardingBanner.hidden = true;
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      /* ignore storage restrictions */
    }
  };

  refs.btnTourAction.addEventListener('click', () => {
    TOUR_STEPS[stepIdx].runAction();
  });

  refs.btnTourNext.addEventListener('click', () => {
    if (stepIdx < TOUR_STEPS.length - 1) {
      stepIdx += 1;
      renderStep();
    } else {
      dismissTour();
    }
  });

  refs.btnTourGlossary.addEventListener('click', openGlossaryDialog);
  refs.btnTourDismiss.addEventListener('click', dismissTour);

  refs.btnStartTour?.addEventListener('click', () => {
    stepIdx = 0;
    renderStep();
    if (refs.guideDialog.open) refs.guideDialog.close();
    refs.onboardingBanner.hidden = false;
    announce('Interactive quick-start tour opened.');
  });

  // Keep viewport unobstructed by default; tour launches on demand from Guide dialog
  refs.onboardingBanner.hidden = true;
}
