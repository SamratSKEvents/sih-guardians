/**
 * Filter controls.
 *
 * The vocabulary a filter panel needs and the rest of the library did not yet
 * have: a pill switch distinct from a checkbox, a two-handle range, a search
 * field, and the small info affordance that carries a definition without
 * spending a line on it.
 *
 * The split between `Toggle` and `Switch` is deliberate and not cosmetic.
 * A checkbox includes or excludes rows from a set, and several of them read as
 * one list. A switch turns a thing on or off in the world, and reads as an
 * independent state. Using one for the other is how a filter panel starts
 * feeling arbitrary.
 */

import { Info, Search as SearchIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* -------------------------------------------------------------------- Info */

/**
 * A definition attached to a label. Native `title`, deliberately: it is
 * keyboard reachable, it survives with JavaScript disabled, and a filter
 * panel does not need a bespoke tooltip layer.
 */
export function InfoDot({ text }: { text: string }) {
  return (
    <span className="ds-info" tabIndex={0} role="note" aria-label={text} title={text}>
      <Info size={12} strokeWidth={2.5} aria-hidden="true" />
    </span>
  );
}

/* ------------------------------------------------------------------ Switch */

export function Switch({
  checked,
  onChange,
  label,
  info,
  value,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  info?: string;
  /** The row's headline figure, aligned with every other row's. */
  value?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="ds-switch">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ds-switch-track" aria-hidden="true">
        <span className="ds-switch-thumb" />
      </span>
      <span className="ds-switch-label">
        {label}
        {info && <InfoDot text={info} />}
      </span>
      {value !== undefined && <span className="ds-switch-value num">{value}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ Search */

export function Search({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Given, the magnifier becomes a real button rather than decoration. */
  onSubmit?: (value: string) => void;
  placeholder: string;
  /** Accessible name. The field carries no visible label in a filter panel. */
  label: string;
}) {
  return (
    <form
      className="ds-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(value);
      }}
    >
      <input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <button type="submit" aria-label={label} tabIndex={onSubmit ? 0 : -1}>
        <SearchIcon size={15} aria-hidden="true" />
      </button>
    </form>
  );
}

/* ------------------------------------------------------------- RangeSlider */

/**
 * Two handles on one rail, with the scale spelled out underneath.
 *
 * The top value can be open-ended: pass `openTop` and the highest step reads
 * as "and above" rather than as a ceiling, which is what an area filter
 * actually means. A slider that silently caps at 100 km2 hides every slick
 * larger than that.
 */
export function RangeSlider({
  label,
  info,
  min,
  max,
  step = 1,
  value,
  onChange,
  ticks,
  openTop,
  unit,
}: {
  label: string;
  info?: string;
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** Values to label beneath the rail. Bare numbers: the unit is in the heading. */
  ticks?: number[];
  openTop?: boolean;
  unit?: string;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [grip, setGrip] = useState<'lo' | 'hi' | null>(null);
  const [lo, hi] = value;

  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  const valueAt = useCallback(
    (clientX: number) => {
      const rect = railRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return min;
      const raw = min + clamp((clientX - rect.left) / rect.width, 0, 1) * (max - min);
      return Math.round(raw / step) * step;
    },
    [min, max, step],
  );

  useEffect(() => {
    if (!grip) return;
    const move = (event: PointerEvent) => {
      const at = valueAt(event.clientX);
      if (grip === 'lo') onChange([clamp(at, min, hi), hi]);
      else onChange([lo, clamp(at, lo, max)]);
    };
    const up = () => setGrip(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [grip, valueAt, lo, hi, min, max, onChange]);

  const keys = (which: 'lo' | 'hi') => (event: React.KeyboardEvent) => {
    const nudge = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    if (!nudge) return;
    event.preventDefault();
    if (which === 'lo') onChange([clamp(lo + nudge, min, hi), hi]);
    else onChange([lo, clamp(hi + nudge, lo, max)]);
  };

  /* Bare numbers on the scale, the unit once in the heading. Repeating "km2"
   * six times under a 280px rail wraps the last stop onto a second line and
   * says nothing the heading has not already said. */
  const cap = (v: number) => `${v}${openTop && v >= max ? '+' : ''}`;
  const heading = `${label} ${cap(lo)} – ${cap(hi)}${unit ? ` ${unit}` : ''}`;

  return (
    <div className="ds-range">
      <p className="ds-range-head">
        {heading}
        {info && <InfoDot text={info} />}
      </p>

      <div className="ds-range-rail" ref={railRef}>
        <span className="ds-range-fill" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
        {(['lo', 'hi'] as const).map((which) => {
          const v = which === 'lo' ? lo : hi;
          return (
            <button
              key={which}
              type="button"
              className="ds-range-handle"
              style={{ left: `${pct(v)}%` }}
              onPointerDown={(event) => {
                event.preventDefault();
                setGrip(which);
              }}
              onKeyDown={keys(which)}
              role="slider"
              aria-label={`${label} ${which === 'lo' ? 'minimum' : 'maximum'}`}
              aria-valuemin={which === 'lo' ? min : lo}
              aria-valuemax={which === 'lo' ? hi : max}
              aria-valuenow={v}
              aria-valuetext={cap(v)}
            />
          );
        })}
      </div>

      {ticks && (
        <div className="ds-range-scale" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ left: `${pct(tick)}%` }} className="num">
              {cap(tick)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- ScaleSlider */

/**
 * One handle, with the two ends named rather than numbered. For a value whose
 * units nobody thinks in: "how strongly must a slick match its candidate
 * source" is a judgement, not a measurement, and putting 0.62 on it would
 * imply a precision the model does not have.
 */
export function ScaleSlider({
  label,
  info,
  value,
  onChange,
  low,
  high,
  steps = 6,
}: {
  label: string;
  info?: string;
  /** 0 to 1. */
  value: number;
  onChange: (value: number) => void;
  low: string;
  high: string;
  steps?: number;
}) {
  return (
    <div className="ds-scale">
      <p className="ds-scale-head">
        {label}
        {info && <InfoDot text={info} />}
      </p>
      <div className="ds-scale-rail">
        <input
          type="range"
          min={0}
          max={1}
          step={1 / steps}
          value={value}
          aria-label={label}
          aria-valuetext={`${Math.round(value * 100)}% toward ${high}`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {/* The stops the handle actually lands on. Without them the control
          * reads as continuous and the steps feel like drift. */}
        <span className="ds-scale-ticks" aria-hidden="true">
          {Array.from({ length: steps + 1 }, (_, i) => (
            <i key={i} style={{ left: `${(i / steps) * 100}%` }} />
          ))}
        </span>
      </div>
      <p className="ds-scale-ends">
        <span>{low}</span>
        <span>{high}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- DateRangeRow */

/**
 * The window the map is cut to.
 *
 * Given `onChange` it is a real control: two native `<input type="date">`, one
 * box each. They are two separate questions — when does the window start, when
 * does it end — and one box holding both reads as a single value that happens
 * to contain a dash. Each field carries its own label for the same reason.
 *
 * Native inputs bring the platform's own calendar, keyboard entry and locale
 * with them. A hand-built picker would be several hundred lines to arrive at
 * a worse one.
 *
 * Without `onChange` it stays what it was — a readout of a window something
 * else owns, marked `readOnly` rather than styled editable and then ignoring
 * clicks.
 *
 * `min` / `max` are the catalog's extent, so the field cannot ask for dates
 * the catalog has nothing to say about.
 */
export function DateRangeRow({
  from,
  to,
  min,
  max,
  onChange,
  onOpen,
}: {
  from: string;
  to: string;
  min?: string;
  max?: string;
  onChange?: (range: [string, string]) => void;
  onOpen?: () => void;
}) {
  if (!onChange) {
    return (
      <button type="button" className="ds-daterange" onClick={onOpen} disabled={!onOpen}>
        <span className="num">
          {from} <i aria-hidden="true">–</i> {to}
        </span>
        <CalendarGlyph />
      </button>
    );
  }

  return (
    <div className="ds-daterange-pair">
      <DateField label="From" value={from} min={min} max={to || max} onChange={(v) => onChange([v, to])} />
      <DateField label="To" value={to} min={from || min} max={max} onChange={(v) => onChange([from, v])} />
    </div>
  );
}

/** One end of the window. Its own field, its own label, its own calendar. */
function DateField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="ds-datefield">
      <span>{label}</span>
      <input
        type="date"
        className="num"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function CalendarGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
