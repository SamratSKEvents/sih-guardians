/**
 * Application shell.
 *
 * Two surfaces. **Spills** opens: the chart is the product, and it is what the
 * work is done on. **Dashboard** is the step back from it — counts, the
 * verification mix, the live queue.
 *
 * The mode is a property of the APPLICATION, not of a surface, so it lives in
 * the bar and persists. Routes carrying a theme each made "which mode am I in"
 * a consequence of navigation.
 *
 * Routing is `location.hash` and a `useSyncExternalStore`. A router library
 * for two static routes with no params would be a dependency doing less than
 * the six lines below already do.
 *
 * The tab strip sits with the two route links and shares their selection: the
 * stage shows a route or a tab, never both, and exactly one header control is
 * current. Tabs are still not routing — they are local state and leave no URL
 * behind, because coming back to a link should give you the surface, not
 * somebody else's open panel. Navigating away leaves a tab open; only its own
 * close button removes it.
 */

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Moon, Play, Sun, X } from 'lucide-react';
import { Button } from './design/components/controls';
import { useMode } from './design/useMode';
// Loaded on first visit: the landing page never pays for the globe (Cesium) or the charts.
const SpillsSurface = lazy(() => import('./surfaces/Spills').then((m) => ({ default: m.SpillsSurface })));
const DemoTour = lazy(() => import('./surfaces/DemoTour').then((m) => ({ default: m.DemoTour })));
const DashboardSurface = lazy(() => import('./surfaces/Dashboard').then((m) => ({ default: m.DashboardSurface })));
import { Landing } from './surfaces/Landing';

import { MAX_TABS, investigationTab, onInvestigate, type TabItem } from './surfaces/tabs';
import './styles.css';

const ROUTES = [
  { id: 'spills', label: 'Spills', render: () => <SpillsSurface /> },
  { id: 'dashboard', label: 'Dashboard', render: () => <DashboardSurface /> },
] as const;

const subscribe = (fn: () => void) => {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
};

function useRoute() {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  );
  const id = hash.replace(/^#\/?/, '');
  // No hash at all is the front door; an unknown one (old `#/demo` links
  // included) still lands on Spills.
  return { route: ROUTES.find((route) => route.id === id) ?? ROUTES[0], landing: id === '' };
}

export function App() {
  const { route, landing } = useRoute();
  // The guided tour is not a route. It starts whenever you enter the app,
  // from the landing page or straight from a link or reload, and from the
  // Demo button. Starting as if from the landing page covers the direct case.
  const [touring, setTouring] = useState(false);
  const wasLanding = useRef(true);
  useEffect(() => {
    if (wasLanding.current && !landing) setTouring(true);
    wasLanding.current = landing;
  }, [landing]);
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [tabId, setTabId] = useState<string>();
  const [mode, setMode] = useMode();
  const next = mode === 'light' ? 'dark' : 'light';
  const tab = tabs.find((option) => option.id === tabId);

  // Following a route link makes the route current. The `onClick` covers
  // clicking the link you are already on, which changes no hash and so fires
  // no event here.
  useEffect(() => setTabId(undefined), [route.id]);

  // Investigate on a slick opens a tab and goes to it. At the cap the oldest
  // panel gives way, which beats refusing to open the thing the user asked for.
  useEffect(
    () =>
      onInvestigate((slickId) => {
        const item = investigationTab(slickId);
        setTabs((current) =>
          current.some((open) => open.id === item.id)
            ? current
            : [...current.slice(Math.max(0, current.length - (MAX_TABS - 1))), item],
        );
        setTabId(item.id);
      }),
    [],
  );

  const close = (id: string) => {
    setTabs((current) => current.filter((item) => item.id !== id));
    // Closing the current tab falls back to the route, which is the only
    // other thing that can hold the stage.
    setTabId((current) => (current === id ? undefined : current));
  };

  if (landing && !tab) return <Landing />;

  return (
    <div className={`app theme-${mode}`}>
      {touring && <Suspense fallback={null}><DemoTour onMap={() => { if (route.id !== 'spills') window.location.hash = '#/spills'; setTabId(undefined); }} onExit={() => setTouring(false)} /></Suspense>}
      <header className="app-bar">
        <a className="app-mark" href="#/" onClick={() => setTabId(undefined)}>GUARDIANS</a>

        <nav aria-label="Surfaces">
          {ROUTES.map((option) => (
            <a
              key={option.id}
              href={`#/${option.id}`}
              aria-current={option.id === route.id && !tab ? 'page' : undefined}
              onClick={() => setTabId(undefined)}
            >
              {option.label}
            </a>
          ))}

          {/* Only when something is open: the separator divides routes from
            * panels, and with no panels there is nothing to divide. */}
          {tabs.length > 0 && (
          <div className="app-tabs" role="tablist" aria-label="Panels">
            {tabs.map((item) => (
              /* The tab and its close button are siblings, not nested buttons:
               * a button inside a button is invalid and the inner one's clicks
               * belong to whichever the browser feels like. */
              <span key={item.id} className="app-tab" data-current={item.id === tab?.id || undefined}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={item.id === tab?.id}
                  onClick={() => setTabId(item.id)}
                >
                  {item.label}
                </button>
                <button
                  type="button"
                  className="app-tab-close"
                  aria-label={`Close ${item.label}`}
                  onClick={() => close(item.id)}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
          )}
        </nav>

        <Button tone="primary" className="app-demo" onClick={() => setTouring(true)} disabled={touring}>
          <Play size={14} strokeWidth={2} aria-hidden="true" />Demo
        </Button>

        <button
          type="button"
          className="app-mode"
          onClick={() => setMode(next)}
          title={`Switch to ${next} mode`}
          aria-label={`Switch to ${next} mode`}
        >
          {mode === 'light' ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      </header>

      <main className="app-stage">
        <Suspense fallback={<div className="app-loading" aria-busy="true">Loading…</div>}>{tab ? tab.render() : route.render()}</Suspense>
      </main>
    </div>
  );
}
