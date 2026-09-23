/**
 * Display, and the two components the project's credibility rests on.
 *
 * `Method` is the one that matters. Any number a model produced can expand to
 * show what produced it, from what inputs, with what confidence, and what it
 * refuses to claim. A console that asserts "source: Vessel A" is a console
 * nobody should believe. One that says "244.6 km2 region, 0.62 confidence,
 * 4096-particle backtrack over 18 h, three vessels crossed, not an
 * attribution" is one a responder can act on and a reviewer can check.
 *
 * `Badge` carries the two vocabularies, deliberately different in form:
 * epistemic claims are neutral chips with a line-form swatch, status is a
 * solid coloured chip. Form keeps them apart, so hue never has to.
 */

import { ChevronRight } from 'lucide-react';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';

/** What kind of claim a value makes. Shown by line form, not by hue. */
export type Claim = 'observed' | 'reconstructed' | 'predicted';

/** How pressing something is. Owns the whole hue budget. */
export type Status = 'critical' | 'warning' | 'watch' | 'clear' | 'inactive';

export const CLAIM_LABEL: Record<Claim, string> = {
  observed: 'Observed',
  reconstructed: 'Reconstructed',
  predicted: 'Predicted',
};

/** How each claim draws on the map, and on its own chip, so the two agree. */
export const CLAIM_STROKE: Record<Claim, string> = {
  observed: 'none',
  reconstructed: '5 3',
  predicted: '2 3',
};

/* ------------------------------------------------------------------- Badge */

/** The line-form swatch. This is what carries the epistemic meaning. */
function ClaimMark({ claim }: { claim: Claim }) {
  return (
    <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden="true" className="ds-claim-mark">
      <line
        x1="0"
        y1="4"
        x2="14"
        y2="4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeDasharray={CLAIM_STROKE[claim] === 'none' ? undefined : CLAIM_STROKE[claim]}
      />
    </svg>
  );
}

export function Badge({
  claim,
  status,
  children,
}: {
  claim?: Claim;
  status?: Status;
  children?: ReactNode;
}) {
  if (claim) {
    return (
      <span className="ds-badge ds-badge-claim">
        <ClaimMark claim={claim} />
        {children ?? CLAIM_LABEL[claim]}
      </span>
    );
  }
  return <span className={`ds-badge ds-badge-${status ?? 'inactive'}`}>{children}</span>;
}

/* ---------------------------------------------------------------- MapLabel */

/**
 * The pill pinned beside an object on the map: what it is, and how pressing.
 *
 * This is the one place the instrument inverts, because it sits on the dark
 * imagery rather than on a panel. It is also the component that makes a globe
 * full of orange blobs readable at a glance without clicking anything.
 */
export function MapLabel({
  id,
  status,
  label,
  selected,
  onClick,
  style,
}: {
  id: string;
  status?: Status;
  label?: string;
  selected?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className={`ds-map-label ${selected ? 'is-selected' : ''}`}
      style={style}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <span className="mono">{id}</span>
      {label && <span className={`ds-map-label-status is-${status ?? 'inactive'}`}>{label}</span>}
    </Tag>
  );
}

/* ------------------------------------------------------------------ Method */

export interface MethodStep {
  label: string;
  /** The concrete value, dataset, or count. Rendered mono. */
  value?: string;
}

/**
 * Show its work.
 *
 * Collapsed it is one quiet line, so the default view stays simple. Expanded
 * it lists the inputs that produced the value and, critically, `refuses`:
 * the claim this result explicitly does not make. Stating the limit is what
 * separates an instrument from a guess with a number on it.
 */
export function Method({
  claim,
  confidence,
  steps,
  refuses,
  at,
}: {
  claim: Claim;
  /** 0 to 1. Omitted when the value is a direct sensor reading. */
  confidence?: number;
  steps: MethodStep[];
  /** What this result does not claim. Always shown when expanded. */
  refuses?: string;
  at: string;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className="ds-method">
      <div className="ds-method-summary">
        <Badge claim={claim} />
        {confidence !== undefined && (
          <span className="ds-method-confidence">
            confidence <span className="num">{confidence.toFixed(2)}</span>
          </span>
        )}
        <time className="ds-method-at num">{at}</time>
      </div>

      <button
        type="button"
        className="ds-method-trigger"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight size={14} strokeWidth={2.25} className="ds-method-caret" data-open={open} />
        How this was computed
      </button>

      {open && (
        <div className="ds-method-body" id={bodyId}>
          <ol>
            {steps.map((step) => (
              <li key={step.label}>
                <span>{step.label}</span>
                {step.value && <span className="mono">{step.value}</span>}
              </li>
            ))}
          </ol>
          {refuses && (
            <p className="ds-method-refuses">
              <strong>Does not claim.</strong> {refuses}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- Stat */

export function Stat({
  label,
  value,
  unit,
  status,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  status?: Status;
  /** One short qualifier. Kept visible, never behind a hover. */
  note?: string;
}) {
  return (
    <div className="ds-stat" data-status={status}>
      <span className="ds-stat-label">{label}</span>
      <span className="ds-stat-value num">
        {value}
        {unit && <span className="ds-stat-unit">{unit}</span>}
      </span>
      {note && <span className="ds-stat-note">{note}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------- Meter */

/**
 * Confidence, with the number always spelled out beside the bar. A bar alone
 * invites reading length as certainty; the figure keeps it honest.
 */
export function Meter({
  label,
  value,
  status,
  caption,
}: {
  label: string;
  /** 0 to 1. */
  value: number;
  status?: Status;
  caption?: string;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="ds-meter" data-status={status ?? (percent >= 70 ? 'clear' : percent >= 40 ? 'warning' : 'critical')}>
      <div className="ds-meter-head">
        <span>{label}</span>
        <span className="num">{value.toFixed(2)}</span>
      </div>
      <div
        className="ds-meter-track"
        role="meter"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {/* scaleX, not width: the transition stays off the layout thread. */}
        <span className="ds-meter-fill" style={{ '--value': percent / 100 } as CSSProperties} />
      </div>
      {caption && <p className="ds-meter-caption">{caption}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------- Field */

export function Field({
  label,
  value,
  note,
  numeric = true,
  identifier,
  status,
}: {
  label: string;
  value: ReactNode;
  /** The caveat that travels with the value. Under it, never in a tooltip. */
  note?: string;
  /** Tabular sans: a measurement. Columns align, but it stays warm. */
  numeric?: boolean;
  /** Mono: something read character by character, such as an id or an MMSI. */
  identifier?: boolean;
  status?: Status;
}) {
  return (
    <div className="ds-field">
      <dt>{label}</dt>
      <dd data-status={status}>
        <span className={identifier ? 'mono' : numeric ? 'num' : undefined}>{value}</span>
        {note && <small>{note}</small>}
      </dd>
    </div>
  );
}

export function FieldList({ children }: { children: ReactNode }) {
  return <dl className="ds-field-list">{children}</dl>;
}
