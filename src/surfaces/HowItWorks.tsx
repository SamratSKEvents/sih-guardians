/**
 * Landing, section two: the six-step evidence pipeline as a staggered trail of
 * cards joined by dashed arrows.
 *
 * Layout is one stage with a fixed aspect ratio. Cards are placed in the stage's
 * own units (read off the mockup at 1672 × 800) as percentages, and the
 * connectors are one SVG in the same viewBox, so both scale together.
 *
 * On first scroll into view the heading, then the cards in pipeline order, rise
 * in; each connector fades in just after the card it leaves. After that only
 * the dashes drift, slowly.
 */

import sea from '../../images/section2bg.webp';
import img1 from '../../images/steps/1.webp';
import img2 from '../../images/steps/2.webp';
import img3 from '../../images/steps/3.webp';
import img4 from '../../images/steps/4.webp';
import img5 from '../../images/steps/5.webp';
import img6 from '../../images/steps/6.webp';
import { useNear, useReveal } from './useReveal';
import './howItWorks.css';

const W = 1672;
const H = 800;

/* x, y, w in stage units; rz / ry: each card's own tilt and 3D lean, read off the reference. */
const CARDS = [
  { x: 60, y: 370, w: 300, rz: 6, ry: -10, title: 'Detect', body: 'Identify slicks from satellite imagery.', img: img1 },
  { x: 450, y: 225, w: 290, rz: -6, ry: 8, title: 'Characterize', body: 'Measure geometry and capture evidence.', img: img2 },
  { x: 735, y: 480, w: 305, rz: 5, ry: -8, title: 'Reconstruct', body: 'Backtrack with currents and wind.', img: img3 },
  { x: 915, y: 95, w: 290, rz: 4, ry: -6, title: 'Predict', body: 'Forecast future drift and spread.', img: img4 },
  { x: 1150, y: 470, w: 315, rz: 5, ry: -10, title: 'Correlate AIS', body: 'Compare vessel movement in the origin window.', img: img5 },
  { x: 1370, y: 150, w: 280, rz: -7, ry: 8, title: 'Rank', body: 'Score suspect vessels and present explainable outputs.', img: img6 },
];

/* Connector i runs from card i to card i + 1; `dot` is the waypoint marker. */
const LINKS = [
  { d: 'M362,560 C400,520 390,440 438,400', dot: [442, 398] },
  { d: 'M596,540 C606,600 660,606 728,600', dot: [596, 536] },
  { d: 'M830,478 C868,440 850,330 900,300', dot: [904, 298] },
  { d: 'M1066,420 C1076,470 1104,488 1146,520', dot: [1066, 416] },
  { d: 'M1470,580 C1514,562 1540,520 1548,468', dot: [1548, 464] },
];

export function HowItWorks() {
  const [ref, shown] = useReveal<HTMLElement>();
  const near = useNear(ref);

  return (
    <section id="mission" ref={ref} className={`hiw${shown ? ' is-in' : ''}`} style={near ? { backgroundImage: `url(${sea})` } : undefined}>
      <div className="hiw-stage" style={{ aspectRatio: `${W} / ${H}` }}>
        <header className="hiw-head">
          <h2>How the<br /><span>System</span> Works</h2>
          <p>A single evidence pipeline that turns satellite<br />signals and vessel traffic into explainable action.</p>
        </header>

        <svg className="hiw-links" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <defs>
            <marker id="hiw-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0 0 L10 5 L0 10 z" />
            </marker>
          </defs>
          {LINKS.map((link, i) => (
            <g key={i} style={{ '--i': i } as React.CSSProperties}>
              <path d={link.d} markerEnd="url(#hiw-arrow)" />
              <circle cx={link.dot[0]} cy={link.dot[1]} r="5" />
            </g>
          ))}
        </svg>

        <ol className="hiw-cards">
          {CARDS.map((card, i) => {
            return (
              <li
                key={card.title}
                className="hiw-card"
                style={{
                  left: `${(card.x / W) * 100}%`,
                  top: `${(card.y / H) * 100}%`,
                  width: `${(card.w / W) * 100}%`,
                  '--i': i,
                  '--rz': `${card.rz}deg`,
                  '--ry': `${card.ry}deg`,
                } as React.CSSProperties}
              >
                <span className="hiw-num">{i + 1}</span>
                <div className="hiw-card-head">
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </div>
                <img src={card.img} alt="" loading="lazy" />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
