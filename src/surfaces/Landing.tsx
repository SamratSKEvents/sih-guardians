/**
 * The front door: what GUARDIANS is, in one screen, before the console.
 *
 * Built from the system rather than beside it: the same tokens, type and
 * Badge, so it follows the mode toggle and reads as the same product. The map
 * is coastline linework with the catalog's Indian-waters detections on it,
 * from the local static catalog.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Crosshair, FileCheck2, Moon, Radar, Satellite, Sun, Waves } from 'lucide-react';
import { Badge, type Claim } from '../design/components';
import type { Mode } from '../design/useMode';
import { loadLandRings } from '../forecast/land';
import { DEMO_SLICKS } from '../api/slicks';
import { investigate } from './tabs';
import './landing.css';

const FLAGSHIP = 'edge:oil_04471';

const STEPS: { n: string; icon: typeof Radar; title: string; q: string; body: string; claim?: Claim }[] = [
  { n: '01', icon: Satellite, title: 'Detect', q: 'Is that dark patch oil?', claim: 'observed',
    body: 'A segmentation model finds dark features in Sentinel-1 and EOS-04 radar. A second, independent model checks each one, and wind, rain and algae are ruled out before anything is called a possible slick.' },
  { n: '02', icon: Crosshair, title: 'Trace', q: 'Where did it come from?', claim: 'reconstructed',
    body: 'Particles run backwards through reanalysis wind and currents to find where the oil was hours earlier. Ships whose AIS tracks cross that region at the right time are ranked. A region and a candidate list, never a verdict.' },
  { n: '03', icon: Waves, title: 'Forecast', q: 'Where is it going?', claim: 'predicted',
    body: 'The same physics runs forwards: advection, spreading, evaporation, dispersion and stranding. Which shoreline gets oil, when, and how much.' },
  { n: '04', icon: FileCheck2, title: 'Respond', q: 'So what do we do?',
    body: 'A SITREP, an ICS action plan and a technical report, drafted from the same computed facts so the numbers cannot disagree between them. A human approves.' },
];

const SOURCES = ['Sentinel-1 SAR', 'EOS-04 / RISAT-1A', 'AIS · coastal + satellite', 'ERA5 wind', 'INCOIS / CMEMS currents', 'GEBCO bathymetry', 'NOAA ADIOS oil library', 'Natural Earth shoreline'];

const BOX = { w: 63.5, e: 95, s: 4, n: 25.5 };

interface Dot { id: string; at: [number, number]; verifier: string }

function IndiaMap() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [land, setLand] = useState<[number, number][][]>([]);
  const [dots, setDots] = useState<Dot[]>([]);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    loadLandRings().then((rings) => setLand(rings.filter((r) => r.some(([x, y]) => x > 55 && x < 100 && y > -5 && y < 35)))).catch(() => undefined);
    setDots(DEMO_SLICKS.flatMap((slick) => {
      const centre = slick.properties.centroid;
      if (!Array.isArray(centre) || Number(centre[0]) < BOX.w || Number(centre[0]) > BOX.e || Number(centre[1]) < BOX.s || Number(centre[1]) > BOX.n) return [];
      return [{ id: slick.id, at: [Number(centre[0]), Number(centre[1])] as [number, number], verifier: String(slick.properties.verifier ?? '') }];
    }));
  }, []);
  const k = Math.cos((((BOX.s + BOX.n) / 2) * Math.PI) / 180);
  const scale = Math.min(size.w / ((BOX.e - BOX.w) * k), size.h / (BOX.n - BOX.s));
  const xy = ([lon, lat]: [number, number]) => [size.w / 2 + (lon - (BOX.w + BOX.e) / 2) * k * scale, size.h / 2 - (lat - (BOX.s + BOX.n) / 2) * scale];
  const d = land.map((r) => r.map((p, i) => `${i ? 'L' : 'M'}${xy(p).map((v) => v.toFixed(1)).join(',')}`).join('') + 'Z').join('');
  const flagship = dots.find((dot) => dot.id === FLAGSHIP);
  const tone = (v: string) => (v === 'MULTI_MODEL_SUPPORTED' ? 'clear' : v === 'LOOKALIKE_WARNING' ? 'watch' : 'warning');

  return (
    <div className="lp-map" ref={ref}>
      {size.w > 0 && (
        <svg width={size.w} height={size.h} aria-hidden="true">
          <path className="lp-land" d={d} />
          {dots.filter((dot) => dot.id !== FLAGSHIP).map((dot) => {
            const [x, y] = xy(dot.at);
            return <circle key={dot.id} className={`lp-dot is-${tone(dot.verifier)}`} cx={x} cy={y} r={3.2} />;
          })}
          {flagship && (() => {
            const [x, y] = xy(flagship.at);
            return (
              <g className="lp-flagship">
                <circle className="lp-ring" cx={x} cy={y} r={16} />
                <circle className="lp-ring lp-ring-late" cx={x} cy={y} r={16} />
                <circle className="lp-dot is-critical" cx={x} cy={y} r={6} />
              </g>
            );
          })()}
        </svg>
      )}
      {flagship && size.w > 0 && (
        <span className="lp-pin" style={{ left: xy(flagship.at)[0] + 16, top: xy(flagship.at)[1] - 16 }}>
          <b>Possible slick</b> Gulf of Kutch · coast in 28 h
        </span>
      )}
      <span className="lp-map-cap">{dots.length ? `${dots.length} radar detections in Indian waters` : 'Loading the catalog…'}</span>
    </div>
  );
}

/** The mode belongs to the application, so the shell passes its own in rather than this page keeping a copy. */
export function Landing({ mode, setMode }: { mode: Mode; setMode: (mode: Mode) => void }) {
  const next = mode === 'light' ? 'dark' : 'light';
  const walk = () => {
    location.hash = '#/spills';
    // After the route has settled, so the shell's route effect does not close the tab it opens.
    window.setTimeout(() => investigate(FLAGSHIP), 60);
  };

  return (
    <div className={`lp theme-${mode}`}>
      <header className="lp-bar">
        <span className="app-mark">GUARDIANS</span>
        <div className="lp-bar-end">
          <button type="button" className="app-mode" onClick={() => setMode(next)} aria-label={`Switch to ${next} mode`}>
            {mode === 'light' ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          <a className="lp-btn lp-btn-ghost" href="#/spills">Open console <ArrowRight size={15} /></a>
        </div>
      </header>

      <section className="lp-hero">
        <div>
          <span className="lp-eyebrow"><Radar size={14} /> Maritime oil-spill intelligence for India's EEZ</span>
          <h1>From a dark patch on radar to a <em>signed response plan</em>, before the oil reaches the coast.</h1>
          <p className="lp-lede">
            GUARDIANS finds possible oil slicks in satellite radar, traces the vessels that may have released them,
            forecasts where the oil will strand, and drafts the response. Every number on screen says how much it
            should be trusted.
          </p>
          <div className="lp-cta">
            <button type="button" className="lp-btn lp-btn-primary" onClick={walk}>Walk through a live incident <ArrowRight size={16} /></button>
            <a className="lp-btn lp-btn-ghost" href="#/dashboard">Dashboard</a>
          </div>
          <dl className="lp-facts">
            <div><dt>Coastline watched</dt><dd className="num">11,098<small> km</small></dd></div>
            <div><dt>EEZ area</dt><dd className="num">2.02<small> M km²</small></dd></div>
            <div><dt>Scene to draft plan</dt><dd className="num">40<small> min</small></dd></div>
          </dl>
        </div>
        <IndiaMap />
      </section>

      <section className="lp-steps">
        {STEPS.map((step) => (
          <article key={step.n} className="lp-step">
            <div className="lp-step-top">
              <span className="num">{step.n}</span>
              <step.icon size={20} />
            </div>
            <h2>{step.title}</h2>
            <p className="lp-step-q">{step.q}</p>
            <p>{step.body}</p>
            {step.claim ? <Badge claim={step.claim} /> : <Badge status="clear">Human decision</Badge>}
          </article>
        ))}
      </section>

      <section className="lp-rule">
        <div>
          <h2>The rule that outranks the rest</h2>
          <p>A console that looks more certain than it is causes wrong boardings and missed beaches. Every figure carries where it came from, and every line on the map is drawn in its form.</p>
        </div>
        <div className="lp-rule-grid">
          <div><Badge claim="observed" /><p>A sensor recorded it. SAR detection, AIS position report.</p></div>
          <div><Badge claim="reconstructed" /><p>A model inferred it about the past. Backtracked drift, source region.</p></div>
          <div><Badge claim="predicted" /><p>A model inferred it about the future. Forecast drift, shoreline exposure.</p></div>
        </div>
      </section>

      <section className="lp-sources">
        <span>Built on</span>
        {SOURCES.map((source) => <span key={source} className="lp-src">{source}</span>)}
      </section>
    </div>
  );
}
