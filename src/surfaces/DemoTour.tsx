import { token as tk } from '../design/token';
/**
 * The guided tour, started on leaving the landing page or from Demo: a tour of one slick, start to end.
 *
 * driver.js dims the app and moves a spotlight onto the one thing each step
 * is about — a card, a map, a button — with the explanation beside it. This
 * file only decides WHAT to show: it switches the page (the Spills map, or a
 * tab of the investigation, through demo.ts), waits for the target to render,
 * then hands it to driver.js, which animates the spotlight and popover there.
 *
 * The popover's content is our own card (TourCard), rendered into driver's
 * shell with the design system's Button, icons and tokens, and carrying the
 * app's theme class, since driver mounts outside the app. Its progress pips
 * are the timer: when the current pip fills, the tour moves on. Hovering the
 * card or pressing pause freezes it.
 * Arrows / space / Esc work too. The flagship is the Gulf of Kutch slick, the
 * one bundle with AIS, suspects, drift, shoreline impact and a response plan.
 */

import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { driver, type Driver, type Side } from 'driver.js';
import 'driver.js/dist/driver.css';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { Button, IconButton } from '../design/components';
import { investigate } from './tabs';
import { demoGoto, type DemoView } from './demo';
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
  /** Seconds before auto-advance. */
  s: number;
}

const STEPS: Step[] = [
  { view: 'map', target: { css: '.earth-map' }, title: 'Every slick, one globe', s: 8,
    body: '13,739 radar-detected slicks from three sources. We follow one of them, off the Gulf of Kutch.' },
  { view: 'map', target: { css: '.ds-legend' }, title: 'Layers', side: 'right', s: 7,
    body: 'Slick density shows where spills concentrate; AIS vessels shows the suspect ships around each case.' },
  { view: { tab: 'detection', page: 'scene' }, target: { css: '.sc-view' }, title: 'Detect', side: 'right', s: 8,
    body: 'The Sentinel-1 radar scene on the left, the model’s oil probability on the right. Drag the divider to compare.' },
  { view: { tab: 'detection', page: 'scene' }, target: { css: '.sc-verdict' }, title: 'A second opinion', side: 'left', s: 7,
    body: 'An independent model agrees this is oil-like. Where they disagree, the slick is flagged for a human, not reported.' },
  { view: { tab: 'detection', page: 'map' }, target: { css: '.leaflet-container' }, title: 'Vessels around it', side: 'right', s: 8,
    body: 'Every ship on AIS in the 12 hours before the satellite pass, replayed around the slick.' },
  { view: { tab: 'detection', page: 'map' }, target: { text: 'Attribution funnel', minW: 300, minH: 180 }, title: 'From 33 ships to 12', side: 'left', s: 8,
    body: 'Filtered by the release window, distance to the traced oil and whether the ship was under way.' },
  { view: { tab: 'temporal', page: 'overview', direction: 'backward' }, target: { css: '.leaflet-container' }, title: 'Trace back', side: 'right', s: 9,
    body: '1,000 particles run backwards through wind and currents. The dashed area is where the oil most likely entered the sea.' },
  { view: { tab: 'temporal', page: 'overview', direction: 'backward' }, target: { text: 'Where the oil came from', minW: 300, minH: 80 }, title: 'Release area and time', side: 'left', s: 7,
    body: 'About 14 hours before the pass, around 27 km west of the slick: a region and a time window, not a false point.' },
  { view: { tab: 'temporal', page: 'vessels', direction: 'backward' }, target: { text: 'Attribution probability', minW: 300, minH: 200 }, title: 'Rank the suspects', side: 'left', s: 9,
    body: 'Each ship’s track is tested against the traced oil. SAMUDRA PRABHA leads: 2.6 km away, AIS silent for 150 minutes.' },
  { view: { tab: 'temporal', page: 'overview', direction: 'forward' }, target: { css: '.leaflet-container' }, title: 'Predict', side: 'right', s: 8,
    body: 'The same physics run forward: where the slick will be at +6, +12 and +24 hours.' },
  { view: { tab: 'temporal', page: 'impact', direction: 'forward' }, target: { text: 'Arrival windows', minW: 300, minH: 160 }, title: 'Shoreline impact', side: 'left', s: 8,
    body: 'Which towns and protected reefs lie in its path, and whether oil reaches them within a day.' },
  { view: { tab: 'response', page: 'overview' }, target: { text: 'Response overview', minW: 300, minH: 80 }, title: 'Protect', side: 'left', s: 7,
    body: 'A response plan built from the forecast: containment, assets, surveillance, clean-up, sampling and alerts.' },
  { view: { tab: 'response', page: 'assets' }, target: { css: '.leaflet-container' }, title: 'Assets on the water', side: 'right', s: 8,
    body: 'Boom, skimmers and patrol vessels placed against the forecast drift, with who is on scene and who is on standby.' },
  { view: { tab: 'response', page: 'alerts' }, target: { css: '.ws-export' }, title: 'Hand it over', side: 'bottom', s: 9,
    body: 'Incident Action Plan, SITREP and a full technical report, generated as PDFs in one click.' },
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

/** Polls until the target renders (pages load their data), or gives up. */
function waitFor(t: Target, ms = 8000): Promise<Element | undefined> {
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
  paused: boolean;
  onPause: (paused: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
}

function TourCard({ index, step, paused: initial, onPause, onPrev, onNext, onExit }: CardProps) {
  const [paused, setPaused] = useState(initial);
  const last = index === STEPS.length - 1;
  const toggle = () => { setPaused(!paused); onPause(!paused); };
  return (
    <div className="gt-card" data-paused={paused || undefined} role="dialog" aria-label="Guided demo" aria-live="polite">
      <div className="gt-pips" aria-hidden="true">
        {STEPS.map((_, k) => (
          <span key={k} className={k < index ? 'is-done' : undefined}>
            {k === index && <i style={{ animationDuration: `${step.s}s` }} onAnimationEnd={last ? undefined : onNext} />}
          </span>
        ))}
      </div>
      <div className="gt-head">
        <span className="gt-step mono">{String(index + 1).padStart(2, '0')} / {STEPS.length}</span>
        <IconButton label="Exit demo (Esc)" className="gt-exit" onClick={onExit}><X size={14} strokeWidth={2} /></IconButton>
      </div>
      <h2 className="gt-title">{step.title}</h2>
      <p className="gt-body">{step.body}</p>
      <div className="gt-controls">
        <IconButton label={paused ? 'Play (Space)' : 'Pause (Space)'} className="gt-pause" onClick={toggle}>
          {paused ? <Play size={14} strokeWidth={2} /> : <Pause size={14} strokeWidth={2} />}
        </IconButton>
        <Button onClick={onPrev} disabled={index === 0} title="Previous step (←)">
          <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />Previous
        </Button>
        <Button tone="primary" onClick={last ? onExit : onNext} title={last ? 'Finish' : 'Next step (→)'}>
          {last ? 'Finish' : 'Next'}{!last && <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- tour */

export function DemoTour({ onMap, onExit }: { onMap: () => void; onExit: () => void }) {
  const d = useRef<Driver | undefined>(undefined);
  const at = useRef(-1);
  const paused = useRef(false);
  const token = useRef(0);
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
      token.current++;
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
      const my = ++token.current;
      const step = STEPS[i];
      const prev = STEPS[at.current];
      const moved = !prev || JSON.stringify(prev.view) !== JSON.stringify(step.view);
      at.current = i;
      if (step.view === 'map') mapRef.current();
      else {
        demoGoto(step.view);
        investigate(FLAGSHIP); // opens the tab once, then just makes it current
      }
      // Let the old page leave before looking, or its map could be picked up.
      if (moved) await new Promise((r) => setTimeout(r, 450));
      const el = await waitFor(step.target);
      if (my !== token.current) return;
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
            const host = document.createElement('div');
            pop.wrapper.appendChild(host);
            const old = card.current;
            if (old) queueMicrotask(() => old.unmount());
            card.current = createRoot(host);
            card.current.render(
              <TourCard index={i} step={step} paused={paused.current} onPause={(p) => { paused.current = p; }}
                onPrev={() => void go(i - 1)} onNext={() => { if (my === token.current) void go(i + 1); }} onExit={exit} />,
            );
          },
        },
      });
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') void go(at.current + 1);
      else if (e.key === 'ArrowLeft') void go(at.current - 1);
      else if (e.key === 'Escape') exit();
      else if (e.key === ' ') {
        e.preventDefault();
        (document.querySelector('.gt-pause') as HTMLButtonElement | null)?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    void go(0);
    return () => {
      window.removeEventListener('keydown', onKey);
      token.current++;
      drv.destroy();
      const old = card.current;
      if (old) queueMicrotask(() => old.unmount());
    };
  }, []);

  return null;
}
