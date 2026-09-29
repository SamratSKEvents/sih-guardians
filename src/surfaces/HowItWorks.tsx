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
import { useLayoutEffect, useRef, useState } from 'react';
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

type Box = { x: number; y: number; w: number; h: number; rz: number };
type Pt = [number, number];
type Side = 't' | 'r' | 'b' | 'l';

/* Connector i runs from card i to card i + 1: [side, 0–1 along it] at each end.
 * Picked by eye: the cards overlap, so a "nearest edge" rule picks badly. */
const LINKS: [Side, number, Side, number][] = [
  ['r', 0.3, 'l', 0.5],
  ['b', 0.3, 'l', 0.3],
  ['r', 0.12, 'b', 0.55],
  ['b', 0.85, 't', 0.3],
  ['r', 0.3, 'b', 0.65],
];

/* A point on a card's edge, pushed out by `gap`, and the edge's outward normal, both turned with the card's tilt. */
function port(b: Box, side: Side, f: number, gap: number): [Pt, Pt] {
  const [u, v, nx, ny] =
    side === 't' ? [(f - 0.5) * b.w, -b.h / 2 - gap, 0, -1]
    : side === 'b' ? [(f - 0.5) * b.w, b.h / 2 + gap, 0, 1]
    : side === 'l' ? [-b.w / 2 - gap, (f - 0.5) * b.h, -1, 0]
    : [b.w / 2 + gap, (f - 0.5) * b.h, 1, 0];
  const c = Math.cos((b.rz * Math.PI) / 180), s = Math.sin((b.rz * Math.PI) / 180);
  return [
    [b.x + b.w / 2 + u * c - v * s, b.y + b.h / 2 + u * s + v * c],
    [nx * c - ny * s, nx * s + ny * c],
  ];
}

function links(boxes: Box[]) {
  if (boxes.length < CARDS.length) return [];
  return LINKS.map(([sa, fa, sb, fb], i) => {
    const [p, n] = port(boxes[i], sa, fa, 8);
    const [q, m] = port(boxes[i + 1], sb, fb, 14);
    const k = Math.max(30, Math.hypot(q[0] - p[0], q[1] - p[1]) * 0.45);
    return {
      d: `M${p[0]},${p[1]} C${p[0] + n[0] * k},${p[1] + n[1] * k} ${q[0] + m[0] * k},${q[1] + m[1] * k} ${q[0]},${q[1]}`,
      dot: p,
    };
  });
}

export function HowItWorks() {
  const [ref, shown] = useReveal<HTMLElement>();
  const near = useNear(ref);
  const cardsRef = useRef<HTMLOListElement>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);

  // Offsets ignore the cards' tilt and reveal slide, so this is where they rest.
  useLayoutEffect(() => {
    const ol = cardsRef.current;
    const stage = ol?.parentElement;
    if (!ol || !stage) return;
    const measure = () => {
      const sx = W / stage.clientWidth, sy = H / stage.clientHeight;
      setBoxes([...ol.children].map((el, i) => {
        const c = el as HTMLElement;
        return { x: c.offsetLeft * sx, y: c.offsetTop * sy, w: c.offsetWidth * sx, h: c.offsetHeight * sy, rz: CARDS[i].rz };
      }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    for (const c of ol.children) ro.observe(c);
    return () => ro.disconnect();
  }, []);

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
          {links(boxes).map((link, i) => (
            <g key={i} style={{ '--i': i } as React.CSSProperties}>
              <path d={link.d} markerEnd="url(#hiw-arrow)" />
              <circle cx={link.dot[0]} cy={link.dot[1]} r="5" />
            </g>
          ))}
        </svg>

        <ol className="hiw-cards" ref={cardsRef}>
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
