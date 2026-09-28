/**
 * The front door: one dark hero, then the scrolling sections below it.
 *
 * The tablet is a flat image drawn in perspective. Its animation is an SVG laid
 * over it in the image's own pixel space (viewBox = image size), so every
 * overlay coordinate below is read straight off tab.webp — no 3D fitting.
 * The tablet and the satellite open the Spills surface.
 */

import sea from '../../images/sea.webp';
import satellite from '../../images/satellite.webp';
import tab from '../../images/tab.webp';
import { HowItWorks } from './HowItWorks';
import { Problem } from './Problem';
import { Impact } from './Impact';
import './landing.css';

const toSpills = () => { location.hash = '#/spills'; };

const STEPS = [
  { title: 'Detect', body: ['Find spills faster', 'with AI and satellite data.'] },
  { title: 'Trace', body: ['Reconstruct origins', 'and follow the evidence.'] },
  { title: 'Predict', body: ['Anticipate movement', 'before it spreads.'] },
  { title: 'Protect', body: ['Enable faster, smarter', 'response for healthier oceans.'] },
];

/* Coordinates in tab.webp pixels (1448 × 1086). */
const SLICK = 'M586,322 C600,306 640,308 655,322 C668,338 690,346 700,370 C708,388 724,398 712,408 C694,412 670,392 650,370 C636,354 610,348 594,340 Z';
const TRACK = 'M664,368 L702,396 L736,420 Q748,442 728,462 Q710,484 722,502 L762,532 L820,572';
const DRIFT = 'M846,624 L993,722';
const DOTS = [[820, 572], [846, 624], [993, 722]];
const DRIFT_INNER = 'M858,632 L981,714'; /* between the two dots, clear of them */
const COAST = '190,300 360,262 440,332 368,420 334,500 362,600 444,700 566,782 626,852 560,866 430,786 318,704 236,552 180,420';
const ISLAND = '712,176 800,170 872,236 846,300 760,336 724,300';
/* Traces of the baked dashed ovals [cx, cy, rx, ry, rotation], plus the drift line. */
const OVALS = [
  [878, 622, 175, 95, 15],
  [912, 675, 160, 72, 20],
  [898, 652, 108, 52, 20],
  [965, 710, 114, 68, 20],
  [1030, 745, 200, 95, 28],
];

/* The next section's anchor. Scrolls rather than setting the hash, which is the app's router. */
const toMission = () => document.getElementById('problem')?.scrollIntoView({ behavior: 'smooth' });

export function Landing() {
  return (
    <div className="landing">
    <div className="hero" style={{ backgroundImage: `url(${sea})` }}>
      <header className="hero-bar">
        <a className="hero-logo" href="#/" aria-label="GUARDIANS home">
          GUARDIANS
          <svg viewBox="0 0 80 10" aria-hidden="true"><path d="M2 5 Q12 0 22 5 T42 5 T62 5 T78 5" /></svg>
        </a>
        <nav className="hero-nav">
          <a href="#solutions">Solutions</a>
          <a href="#technology">Technology</a>
          <a href="#impact">Impact</a>
          <a href="#about">About</a>
        </nav>
      </header>

      <main className="hero-main">
        <ol className="hero-steps">
          {STEPS.map((step, i) => (
            <li key={step.title} style={{ '--i': i } as React.CSSProperties}>
              {/* Icon placeholder: drop the supplied icon inside .hero-icon. */}
              <span className="hero-icon" aria-hidden="true" />
              <div>
                <h2>{step.title}<span className="dot">.</span></h2>
                <p>{step.body[0]}<br />{step.body[1]}</p>
              </div>
              {i < STEPS.length - 1 && (
                <svg className="hero-arrow" viewBox="0 0 150 110" aria-hidden="true">
                  <path d="M6 2 C6 70 40 96 136 96" />
                  <path d="M124 86 L138 96 L124 106" />
                </svg>
              )}
            </li>
          ))}
        </ol>
        {/* Button leads; the line under it is centred on it. */}
        <div className="hero-action">
          <button className="hero-cta" onClick={toMission}>Discover the mission <span className="arrow" aria-hidden="true">→</span></button>
          <p className="hero-lede">
            From detection to decision, GUARDIANS turns<br />ocean data into a cleaner, safer tomorrow.
          </p>
          <a className="hero-demo" href="#/demo">▶ Watch the demo</a>
        </div>
      </main>

      <button className="hero-sat" onClick={toSpills} aria-label="Open the spill map">
        <img src={satellite} alt="" />
      </button>

      <button className="hero-tab" onClick={toSpills} aria-label="Open the spill map">
        <img src={tab} alt="" />
        <svg className="hero-sim" viewBox="0 0 1448 1086" aria-hidden="true">
          <defs>
            <filter id="swell" x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="2" seed="4">
                <animate attributeName="baseFrequency" dur="14s" repeatCount="indefinite"
                  values="0.012 0.03;0.014 0.036;0.012 0.03" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" scale="7.2" />
            </filter>
            <filter id="soft"><feGaussianBlur stdDeviation="14" /></filter>
            <filter id="glow"><feGaussianBlur stdDeviation="6" /></filter>
            {/* Blur smears thin dashes into the glow around them; masked along the ovals it hides the baked ones. */}
            <filter id="erase">
              <feGaussianBlur stdDeviation="5" />
              <feComponentTransfer>
                <feFuncR type="linear" slope="0.8" /><feFuncG type="linear" slope="0.8" /><feFuncB type="linear" slope="0.8" />
              </feComponentTransfer>
            </filter>
            <filter id="feather"><feGaussianBlur stdDeviation="3" /></filter>
            <mask id="ovalBand">
              <g className="band" filter="url(#feather)">
                {OVALS.map(([cx, cy, rx, ry, rot], i) => (
                  <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rot} ${cx} ${cy})`} />
                ))}
                <path d={DRIFT_INNER} />
                {/* Keep the baked dots sharp. */}
                {DOTS.map(([x, y]) => <circle key={x} cx={x} cy={y} r="12" fill="#000" stroke="none" />)}
              </g>
            </mask>
            <mask id="coast">
              <g fill="#fff" filter="url(#soft)">
                <polygon points={COAST} />
                <polygon points={ISLAND} />
              </g>
            </mask>
          </defs>

          {/* Land: the surf already in the picture, gently displaced. */}
          <image href={tab} width="1448" height="1086" filter="url(#swell)" mask="url(#coast)" />

          {/* Dotted ovals: the baked dashes are erased and redrawn as real dashes that march. */}
          <image href={tab} width="1448" height="1086" filter="url(#erase)" mask="url(#ovalBand)" />
          <g className="sim-ovals">
            {OVALS.map(([cx, cy, rx, ry, rot], i) => (
              <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rot} ${cx} ${cy})`}
                className={i % 2 ? 'ccw' : undefined} />
            ))}
            <path className="drift" d={DRIFT_INNER} />
          </g>

          {/* Slick: a slow breathing glow on its edge. */}
          <path className="sim-slick" d={SLICK} filter="url(#glow)" />

          {/* Backward track: dashes creeping back toward the slick. */}
          <path className="sim-track" d={TRACK} />

          {/* Forecast: uncertainty rippling outward from the drift origin. */}
          <g transform="translate(900 660) rotate(24)">
            {[0, 1, 2].map((n) => (
              <ellipse key={n} className="sim-ripple" rx="250" ry="120" style={{ animationDelay: `${n * 3}s` }} />
            ))}
          </g>

          {/* Particles drifting along the forecast path. */}
          {[0, 1.6, 3.2].map((begin) => (
            <circle key={begin} className="sim-particle" r="3.5">
              <animateMotion dur="4.8s" begin={`${begin}s`} repeatCount="indefinite" path={DRIFT} />
            </circle>
          ))}
        </svg>
      </button>

    </div>
    <Problem />
    <HowItWorks />
    <Impact />
    </div>
  );
}
