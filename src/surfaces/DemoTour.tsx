import { token as tk } from '../design/token';
/**
 * The guided tour, started on entering the app or from Demo: one slick, from
 * the globe to its investigation.
 *
 * The order is the order a person would use the app in: the globe, what is on
 * it (slicks and vessels), one slick zoomed to with its card open, Investigate
 * on that card, then the few pages of the investigation that answer "what,
 * who, where next, what to do".
 *
 * driver.js dims the app and spotlights the one thing each step is about, with
 * our own card (TourCard) as the popover. Nothing advances on a timer: Next,
 * the → key, or doing the thing the step asks (clicking Investigate) moves on.
 * The flagship is the Gulf of Kutch slick, the one bundle with AIS, suspects,
 * drift, shoreline impact and a response plan.
 */

import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { driver, type Driver, type Side } from 'driver.js';
import 'driver.js/dist/driver.css';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button, IconButton } from '../design/components';
import { investigate, onInvestigate } from './tabs';
import { demoGoto, demoSelectSlick, type DemoView } from './demo';
import './demoTour.css';

const FLAGSHIP = 'edge:oil_04471';

/** A CSS selector, or a heading's text: the target is the card around it (grown until at least minW × minH). */
type Target = { css: string } | { text: string; minW?: number; minH?: number };

interface Step {
  view: DemoView | 'map';
  target: Target;
  title: string;
  body: string;
  side?: Side;
  /** Pick the flagship on the globe (fly to it, open its card) on entering. */
  select?: boolean;
  /** Next on this step clicks Investigate, as the person would. */
  investigates?: boolean;
}

const STEPS: Step[] = [
  { view: 'map', target: { css: '.earth-map' }, title: 'Every slick, one globe',
    body: '13,739 radar-detected oil slicks from three sources, on one globe. Drag to turn it, scroll to zoom.' },
  { view: 'map', target: { css: '.ds-legend' }, title: 'Slicks and vessels', side: 'right',
    body: 'Oil slicks are the orange shapes. AIS vessels are the ships that were near them. Slick density shows where spills cluster.' },
  { view: 'map', target: { css: '.slick-card' }, title: 'One slick, up close', side: 'top', select: true,
    body: 'We zoom to a slick off the Gulf of Kutch. Its card gives the size, the date of the pass and how sure the model is.' },
  { view: 'map', target: { css: '.slick-card-open' }, title: 'Investigate it', side: 'top', select: true, investigates: true,
    body: 'Investigate opens the full case for this slick. Click it, or press Next.' },
  { view: { tab: 'detection', page: 'scene' }, target: { css: '.sc-view' }, title: 'Is it oil?', side: 'right',
    body: 'The Sentinel-1 radar scene beside the model’s oil probability. A second, independent model checks the call.' },
  { view: { tab: 'temporal', page: 'overview', direction: 'backward' }, target: { css: '.leaflet-container' }, title: 'Where did it come from?', side: 'right',
    body: 'Particles run backwards through wind and currents. The dashed area is where the oil most likely entered the sea.' },
  { view: { tab: 'temporal', page: 'vessels', direction: 'backward' }, target: { text: 'Attribution probability', minW: 300, minH: 200 }, title: 'Who released it?', side: 'left',
    body: 'Each ship’s track is tested against the traced oil. SAMUDRA PRABHA leads: 2.6 km away, AIS silent for 150 minutes.' },
  { view: { tab: 'temporal', page: 'impact', direction: 'forward' }, target: { text: 'Arrival windows', minW: 300, minH: 160 }, title: 'Where is it going?', side: 'left',
    body: 'Run forward, the drift shows which towns and protected reefs lie in its path, and when oil reaches them.' },
  { view: { tab: 'response', page: 'alerts' }, target: { css: '.ws-export' }, title: 'What to do', side: 'bottom',
    body: 'A response plan built from the forecast, handed over as an Incident Action Plan, SITREP and full report in one click.' },
];

/* ------------------------------------------------------------ targeting */

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** The element a heading text belongs to: the smallest ancestor at least minW × minH. */
function byText(q: string, minW = 240, minH = 60): Element | undefined {
  const want = q.toLowerCase();
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,header,strong,b,span,p,div,dt,th,summary')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim().toLowerCase();
    if (!own.startsWith(want) || !visible(el) || el.closest('.driver-popover')) continue;
    let box: Element = el;
    while (box.parentElement && box.parentElement !== document.body) {
      const r = box.getBoundingClientRect();
      if (r.width >= minW && r.height >= minH) break;
      box = box.parentElement;
    }
    return box;
  }
  return undefined;
}

function resolve(t: Target): Element | undefined {
  if ('css' in t) return [...document.querySelectorAll(t.css)].find(visible);
  return byText(t.text, t.minW, t.minH);
}

/** Polls until the target renders (pages load their data, the camera flies), or gives up. */
function waitFor(t: Target, ms = 10000): Promise<Element | undefined> {
  return new Promise((done) => {
    const t0 = performance.now();
    const tick = () => {
      const el = resolve(t);
      if (el || performance.now() - t0 > ms) return done(el);
      setTimeout(tick, 150);
    };
    tick();
  });
}

/* ----------------------------------------------------------------- card */

interface CardProps {
  index: number;
  step: Step;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}

function TourCard({ index, step, onPrev, onNext, onExit }: CardProps) {
  const last = index === STEPS.length - 1;
  return (
    <div className="gt-card" role="dialog" aria-label="Guided demo" aria-live="polite">
      <div className="gt-pips" aria-hidden="true">
        {STEPS.map((_, k) => <span key={k} className={k <= index ? 'is-done' : undefined} />)}
      </div>
      <div className="gt-head">
        <span className="gt-step mono">{String(index + 1).padStart(2, '0')} / {STEPS.length}</span>
        <IconButton label="Exit demo (Esc)" className="gt-exit" onClick={onExit}><X size={14} strokeWidth={2} /></IconButton>
      </div>
      <h2 className="gt-title">{step.title}</h2>
      <p className="gt-body">{step.body}</p>
      <div className="gt-controls">
        <Button onClick={onPrev} disabled={index === 0} title="Previous step (←)">
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />Back
        </Button>
        <Button tone="primary" className="gt-next" onClick={last ? onExit : onNext} title={last ? 'Finish' : 'Next step (→)'}>
          {last ? 'Finish' : step.investigates ? 'Investigate' : 'Next'}{!last && <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- tour */

export function DemoTour({ onMap, onExit }: { onMap: () => void; onExit: () => void }) {
  const d = useRef<Driver | undefined>(undefined);
  const at = useRef(-1);
  const run = useRef(0);
  const card = useRef<Root | undefined>(undefined);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const mapRef = useRef(onMap);
  mapRef.current = onMap;

  useEffect(() => {
    const drv = driver({
      animate: true,
      overlayColor: tk('--neutral-800'),
      overlayOpacity: 0.62,
      stagePadding: 10,
      stageRadius: 14,
      smoothScroll: true,
      allowClose: false,
      allowKeyboardControl: false,
      overlayClickBehavior: () => undefined,
      popoverClass: 'gt-pop',
      popoverOffset: 14,
      showButtons: [],
    });
    d.current = drv;

    const exit = () => {
      run.current++;
      document.body.classList.remove('gt-clear');
      drv.destroy();
      const old = card.current;
      card.current = undefined;
      if (old) queueMicrotask(() => old.unmount());
      demoGoto(undefined);
      exitRef.current();
    };

    const go = async (i: number) => {
      if (i < 0) return;
      if (i >= STEPS.length) return exit();
      const my = ++run.current;
      const step = STEPS[i];
      const prev = STEPS[at.current];
      const moved = !prev || JSON.stringify(prev.view) !== JSON.stringify(step.view);
      at.current = i;
      if (step.view === 'map') {
        mapRef.current();
        // The globe has to mount before it can hear which slick to show.
        if (step.select) setTimeout(() => my === run.current && demoSelectSlick(FLAGSHIP), moved ? 600 : 0);
      } else {
        demoGoto(step.view);
        investigate(FLAGSHIP); // opens the tab once, then just makes it current
      }
      // Let the old page leave before looking, or its map could be picked up.
      if (moved) await new Promise((r) => setTimeout(r, 450));
      // The camera is still flying to the slick; let the card settle first.
      if (step.select && !prev?.select) await new Promise((r) => setTimeout(r, 3200));
      const el = await waitFor(step.target);
      if (my !== run.current) return;
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      // On the zoomed slick the map already spotlights the slick; a second
      // dim over it only makes the oil harder to see.
      document.body.classList.toggle('gt-clear', Boolean(step.select));
      drv.highlight({
        element: el,
        popover: {
          side: step.side,
          align: 'start',
          showButtons: [],
          onPopoverRender: (pop) => {
            // Driver mounts on <body>, outside the app: bring the app's theme with it.
            const theme = document.querySelector('.app')?.className.match(/theme-\w+/)?.[0];
            if (theme) pop.wrapper.classList.add(theme);
            // Placement is CSS anchor positioning (demoTour.css), not driver's
            // maths: it flips or falls back when the side has no room.
            pop.wrapper.dataset.side = step.side ?? 'bottom';
            const host = document.createElement('div');
            pop.wrapper.appendChild(host);
            const old = card.current;
            if (old) queueMicrotask(() => old.unmount());
            card.current = createRoot(host);
            card.current.render(
              <TourCard index={i} step={step} onPrev={() => void go(i - 1)} onNext={() => void go(i + 1)} onExit={exit} />,
            );
          },
        },
      });
    };

    // Clicking the real Investigate button on the Investigate step is the
    // same as pressing Next there.
    const offInvestigate = onInvestigate(() => {
      if (STEPS[at.current]?.investigates) void go(at.current + 1);
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') void go(at.current + 1);
      else if (e.key === 'ArrowLeft') void go(at.current - 1);
      else if (e.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    void go(0);
    return () => {
      window.removeEventListener('keydown', onKey);
      offInvestigate();
      document.body.classList.remove('gt-clear');
      run.current++;
      drv.destroy();
      const old = card.current;
      if (old) queueMicrotask(() => old.unmount());
    };
  }, []);

  return null;
}
