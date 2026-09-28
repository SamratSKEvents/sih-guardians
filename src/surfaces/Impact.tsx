import { token } from '../design/token';
/**
 * Landing, section four: "From uncertainty to actionable clarity".
 *
 * Two stacks of three map layers, tilted flat like sheets on a table: without
 * GUARDIANS (grey, scattered) and with it (lit, resolved), split by a glowing
 * seam. Four benefit cards sit on the reef below.
 *
 * On first scroll into view each stack fans out from a single sheet into its
 * three layers — the data coming apart into its parts — the seam draws down,
 * and the cards rise in. After that the "with" stack only floats, slowly.
 */

import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowRight, Crosshair, Leaf, Shield, Zap, type LucideIcon } from 'lucide-react';
import bg from '../../images/s4-bg.webp';
import w1 from '../../images/s4-1.webp';
import w2 from '../../images/s4-2.webp';
import w3 from '../../images/s4-3.webp';
import g1 from '../../images/s4-4.webp';
import g2 from '../../images/s4-5.webp';
import g3 from '../../images/s4-6.webp';
import { useNear, useReveal } from './useReveal';
import './impact.css';

const WITHOUT = [w1, w2, w3];
const WITH = [g1, g2, g3];

const BENEFITS: { icon: LucideIcon; tone: string; title: string; body: [string, string] }[] = [
  { icon: Zap, tone: token('--teal-200-c'), title: 'Faster Response', body: ['Get actionable insights', 'in hours, not days.'] },
  { icon: Crosshair, tone: token('--green-200'), title: 'Stronger Attribution', body: ['Link slicks to responsible', 'vessels with clear evidence.'] },
  { icon: Shield, tone: token('--blue-300-d'), title: 'Defensible Evidence', body: ['Every conclusion is', 'traceable and explainable.'] },
  { icon: Leaf, tone: token('--lime-200-b'), title: 'Better Protection', body: ['Help safeguard coastlines,', 'marine life and communities.'] },
];

/* Counted from the app's own data: public/data/catalog and public/data/incidents. */
const STATS: { value: number; suffix?: string; label: string }[] = [
  { value: 13739, label: 'Oil slicks catalogued' },
  { value: 18770, suffix: ' km²', label: 'Of slick mapped' },
  { value: 643, label: 'AIS vessels screened' },
  { value: 79, label: 'Satellite passes cross-checked' },
  { value: 97, suffix: ' h', label: 'Of drift modelled' },
];

/* Eases 0 → to over ~1.6s once `run` turns true. */
function useCount(to: number, run: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(to); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 1600);
      setN(Math.round(to * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  return n;
}

function Stat({ value, suffix, label, run }: { value: number; suffix?: string; label: string; run: boolean }) {
  return <li><strong>{useCount(value, run).toLocaleString('en-US')}{suffix}</strong><span>{label}</span></li>;
}

function Stack({ images, side }: { images: string[]; side: 'without' | 'with' }) {
  return (
    <div className={`imp-stack imp-${side}`}>
      {images.map((src, i) => (
        <div key={src} className="imp-layer" style={{ '--l': i } as CSSProperties}>
          <img src={src} alt="" loading="lazy" />
        </div>
      ))}
    </div>
  );
}

export function Impact() {
  const [ref, shown] = useReveal<HTMLElement>();
  const near = useNear(ref);

  return (
    <section id="impact" ref={ref} className={`imp${shown ? ' is-in' : ''}`} style={near ? { backgroundImage: `url(${bg})` } : undefined}>
      <header className="imp-head">
        <span className="imp-eyebrow">
          Impact
          <svg viewBox="0 0 80 10" aria-hidden="true"><path d="M2 5 Q12 0 22 5 T42 5 T62 5 T78 5" /></svg>
        </span>
        <h2>From uncertainty<br />to <span>actionable clarity</span></h2>
        <p>GUARDIANS turns complex ocean data into clear answers,<br />helping investigators respond faster, hold polluters responsible,<br />and protect our oceans.</p>
      </header>

      <div className="imp-compare">
        <div className="imp-side">
          <div className="imp-label imp-label-without">
            <strong>Without GUARDIANS</strong>
            <span>Scattered data. Unclear source.<br />Delayed action.</span>
          </div>
          <Stack images={WITHOUT} side="without" />
        </div>

        <div className="imp-seam" aria-hidden="true">
          <span className="imp-seam-line" />
          <span className="imp-seam-btn"><ArrowRight strokeWidth={1.6} /></span>
        </div>

        <div className="imp-side">
          <div className="imp-label imp-label-with">
            <strong>With GUARDIANS</strong>
            <span>Clear source. Ranked evidence.<br />Focused response.</span>
          </div>
          <Stack images={WITH} side="with" />
          <div className="imp-tag">
            <strong>Likely Source Vessel</strong>
            <span>92% match</span>
          </div>
        </div>
      </div>

      <ul className="imp-benefits">
        {BENEFITS.map((b, i) => {
          const Icon = b.icon;
          return (
            <li key={b.title} style={{ '--i': i, '--tone': b.tone } as CSSProperties}>
              <Icon strokeWidth={1.5} />
              <h3>{b.title}</h3>
              <p>{b.body[0]}<br />{b.body[1]}</p>
            </li>
          );
        })}
      </ul>

      <StatsBand />
    </section>
  );
}

/* Has its own reveal: it sits at the very bottom, well after the section's. */
function StatsBand() {
  const [ref, shown] = useReveal<HTMLUListElement>();
  return (
    <ul ref={ref} className={`imp-stats${shown ? ' is-in' : ''}`}>
      {STATS.map((s) => <Stat key={s.label} {...s} run={shown} />)}
    </ul>
  );
}
