/**
 * Landing, section three: "What's the Problem?" — two tilted glass panels,
 * the problem and its causes, each an image with callout chips pinned to it.
 *
 * Chip and pin positions are percentages of the image, so they stay on their
 * subject at any width. On first scroll into view the panels rise in, then the
 * leader lines draw and the chips settle, one after another.
 */

import type { CSSProperties } from 'react';
import { CircleHelp, Clock, Crosshair, EyeOff, Fish, Settings, Ship, Waves, WifiOff, type LucideIcon } from 'lucide-react';
import bg from '../../images/section2bg.webp';
import problemImg from '../../images/screen3-2.webp';
import causesImg from '../../images/screen3-1.webp';
import { useNear, useReveal } from './useReveal';
import './problem.css';

/* chip: chip centre, pin: what it points at — both in % of the image. */
interface Callout { icon: LucideIcon; label: [string, string]; chip: [number, number]; pin: [number, number] }

const PANELS: { icon: LucideIcon; title: string; body: [string, string]; img: string; tone: 'red' | 'cyan'; callouts: Callout[] }[] = [
  {
    icon: Crosshair,
    title: 'Problem',
    body: ['Oil spills damage fragile marine ecosystems and coastal waters.', 'Finding the responsible vessel is often slow and uncertain.'],
    img: problemImg,
    tone: 'red',
    callouts: [
      { icon: Fish, label: ['Ecosystem', 'damage'], chip: [20, 58], pin: [36, 76] },
      { icon: Waves, label: ['Coastal', 'risk'], chip: [80, 14], pin: [90, 36] },
      { icon: EyeOff, label: ['Unattributed', 'spills'], chip: [72, 62], pin: [58, 44] },
      { icon: Clock, label: ['Slow', 'investigation'], chip: [45, 12], pin: [30, 22] },
    ],
  },
  {
    icon: Settings,
    title: 'Causes',
    body: ['Drift, multiple nearby vessels, and incomplete AIS make attribution difficult.', 'Look-alikes and changing slick shape add further uncertainty.'],
    img: causesImg,
    tone: 'cyan',
    callouts: [
      { icon: Waves, label: ['Drift', 'changes shape'], chip: [80, 88], pin: [86, 72] },
      { icon: CircleHelp, label: ['Origin', 'unclear'], chip: [82, 14], pin: [65, 50] },
      { icon: Ship, label: ['Many vessels', 'nearby'], chip: [48, 16], pin: [72, 32] },
      { icon: WifiOff, label: ['AIS can be', 'incomplete'], chip: [16, 58], pin: [22, 24] },
    ],
  },
];

export function Problem() {
  const [ref, shown] = useReveal<HTMLElement>();
  const near = useNear(ref);

  return (
    <section id="problem" ref={ref} className={`p3${shown ? ' is-in' : ''}`} style={near ? { backgroundImage: `url(${bg})` } : undefined}>
      <header className="p3-head">
        <h2>What’s the <span>Problem?</span></h2>
      </header>

      <div className="p3-panels">
        {PANELS.map((panel, p) => {
          const Icon = panel.icon;
          return (
            <article key={panel.title} className={`p3-panel p3-${panel.tone}`} style={{ '--p': p } as CSSProperties}>
              <div className="p3-panel-head">
                <span className="p3-ring"><Icon strokeWidth={1.6} /></span>
                <div>
                  <h3>{panel.title}</h3>
                  <p>{panel.body[0]}<br />{panel.body[1]}</p>
                </div>
              </div>

              <div className="p3-media">
                <img src={panel.img} alt="" loading="lazy" />
                <svg className="p3-leaders" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {panel.callouts.map((c, i) => (
                    <line key={i} x1={c.chip[0]} y1={c.chip[1]} x2={c.pin[0]} y2={c.pin[1]}
                      pathLength={1} style={{ '--i': i } as CSSProperties} />
                  ))}
                </svg>
                {panel.callouts.map((c, i) => {
                  const ChipIcon = c.icon;
                  return (
                    <span key={i} style={{ '--i': i } as CSSProperties}>
                      <span className="p3-pin" style={{ left: `${c.pin[0]}%`, top: `${c.pin[1]}%` }} />
                      <span className="p3-chip" style={{ left: `${c.chip[0]}%`, top: `${c.chip[1]}%` }}>
                        <ChipIcon strokeWidth={1.6} />
                        <span>{c.label[0]}<br />{c.label[1]}</span>
                      </span>
                    </span>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
