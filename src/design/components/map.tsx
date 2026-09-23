/**
 * Map furniture: the things that sit on a chart in every theme.
 *
 * Both of these were the only parts of the tactical route worth keeping, so
 * they moved here rather than keeping a whole route alive to hold them.
 *
 * Neither owns a domain icon. The caller passes the glyph, so the library
 * never has to know what a SAR chain or an AIS feed is.
 */

import { ChevronDown, Layers } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

/* --------------------------------------------------------------- HealthRow */

export type HealthState = 'ok' | 'degraded' | 'down';

export interface HealthItem {
  id: string;
  /** Four or five characters. This row is scanned, not read. */
  label: string;
  state: HealthState;
  icon?: ReactNode;
  /** Why it is degraded. Shown on hover and to screen readers. */
  detail?: string;
}

/**
 * The state of every input the answers depend on, in one glance.
 *
 * The whole value is that a healthy row is monochrome, so the one degraded
 * item is the only coloured thing in it. A row that colours all six green
 * makes the amber one just another colour and defeats the point.
 *
 * `note` spells out the consequence rather than the fault: an operator does
 * not need to know a model is down, they need to know which claims on screen
 * are now unverified.
 */
export function HealthRow({ items, note }: { items: readonly HealthItem[]; note?: string }) {
  const bad = items.filter((item) => item.state !== 'ok');
  return (
    <div className="ds-health">
      <ul>
        {items.map((item) => (
          <li key={item.id} data-state={item.state} title={item.detail}>
            <span className="ds-health-icon" aria-hidden="true">
              {item.icon ?? <span className="ds-health-dot" />}
            </span>
            <span className="ds-health-label">{item.label}</span>
            <span className="visually-hidden">
              {item.state === 'ok' ? 'healthy' : item.state}
              {item.detail ? `. ${item.detail}` : ''}
            </span>
          </li>
        ))}
      </ul>
      {note && (
        <p className="ds-health-note" role={bad.length ? 'status' : undefined}>
          {note}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ MapStatusBar */

/**
 * The strip along the bottom edge of a chart: where the cursor is, what the
 * scale is, anything continuously true of the view rather than of a selection.
 *
 * It is the one piece of chrome that should never move or animate. An
 * operator reads a coordinate off it mid-sentence on a radio call.
 */
export function MapStatusBar({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  return (
    <div className="ds-map-status">
      {items.map((item) => (
        <span key={item.label}>
          {item.label} <b className="mono">{item.value}</b>
        </span>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- MapLegend */

/**
 * The layer legend, docked on the chart it describes.
 *
 * This belongs on the map, not in the filter rail. A legend answers "what am
 * I looking at", which is a question about the thing under your cursor; a
 * filter answers "what should be here at all", which is a question about the
 * query. Putting the legend in a side menu means reading a swatch requires
 * looking away from the mark it explains.
 *
 * Collapsed it is one button carrying the count of layers actually drawn, so
 * folding it away never hides that something is switched off.
 */
export function MapLegend({
  title = 'Layers',
  shown,
  total,
  children,
}: {
  title?: string;
  /** How many layers are drawing. Carried on the collapsed button. */
  shown: number;
  total: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();

  if (!open) {
    return (
      <div className="ds-legend ds-legend-closed">
        <button type="button" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={bodyId}>
          <Layers size={15} />
          {title}
          <span className="ds-legend-count num">
            {shown}/{total}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="ds-legend">
      <button
        type="button"
        className="ds-legend-head"
        onClick={() => setOpen(false)}
        aria-expanded
        aria-controls={bodyId}
      >
        <Layers size={15} />
        {title}
        <span className="ds-legend-count num">
          {shown}/{total}
        </span>
        <ChevronDown size={14} strokeWidth={2.25} className="ds-legend-caret" />
      </button>
      <div className="ds-legend-body" id={bodyId}>
        {children}
      </div>
    </div>
  );
}
