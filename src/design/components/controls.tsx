/**
 * Controls.
 *
 * Controls are achromatic. Hue on this screen belongs to status, so a
 * colourised button would read as a priority signal. The primary action is
 * ink-filled instead: unmistakably the main action, and impossible to confuse
 * with a claim about data.
 */

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

/* ------------------------------------------------------------------ Button */

export type ButtonTone = 'primary' | 'default' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
}

/**
 * `danger` is the only control allowed a hue, and only for an action that
 * destroys work or dispatches something real. Not for "clear filter".
 */
export function Button({ tone = 'default', className = '', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`ds-button ds-button-${tone} ${className}`} {...rest} />;
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: the glyph carries no text, so this is the only accessible name. */
  label: string;
  children: ReactNode;
}

export function IconButton({ label, children, className = '', type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={`ds-icon-button ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- Segmented */

/**
 * One choice from two to four. Above four options use a Select: a segmented
 * control that wraps to a second line is broken.
 *
 * Rendered as buttons with aria-pressed rather than radios, because these
 * switch a view immediately rather than staging a value for submission.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  /** `title` is optional: a one-line explanation for a label too terse to
   *  stand alone, shown on hover and as the accessible description. */
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="ds-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          aria-pressed={option.value === value}
          title={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Toggle */

/**
 * A layer switch. The whole row is the hit target.
 *
 * `swatch` shows how the layer actually draws, so the panel is a legend and a
 * control at once. An operator should never have to toggle a layer on to find
 * out what it looks like. `description` stays visible rather than hiding in a
 * tooltip: it is the only place a synthetic or degraded layer can say so.
 */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  swatch,
  value,
  dense,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  swatch?: ReactNode;
  /**
   * The row's headline figure, right-aligned in its own column.
   *
   * A legend or a filter list without these makes the operator toggle things
   * to find out what is behind them. With them the column is scannable: how
   * much is on the chart, how much each filter would remove.
   */
  value?: ReactNode;
  /**
   * One line per row, with the description moved to the row's tooltip.
   *
   * For a legend, which is read by scanning down a column of swatches. The
   * two-line form is for a settings list, where the description is doing real
   * work and nobody is scanning.
   */
  dense?: boolean;
  disabled?: boolean;
}) {
  const showDescription = description && !dense;
  return (
    <label
      className={`ds-toggle ${showDescription ? 'has-description' : ''} ${dense ? 'is-dense' : ''}`}
      title={dense ? description : undefined}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {swatch && <span className="ds-toggle-swatch">{swatch}</span>}
      <span className="ds-toggle-text">
        <span className="ds-toggle-label">{label}</span>
        {showDescription && <span className="ds-toggle-description">{description}</span>}
      </span>
      {value !== undefined && <span className="ds-toggle-value num">{value}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ Slider */

/**
 * A continuous adjustment with its value always visible. The readout is mono
 * and fixed-width so the row does not reflow while dragging.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 0.05,
  format = (v: number) => v.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="ds-slider">
      <span className="ds-slider-label">{label}</span>
      <output className="num">{format(value)}</output>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/* ------------------------------------------------------------------ Select */

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  label: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}

/** Native select on purpose: it is keyboard-correct and it works on a phone. */
export function Select({ label, options, onChange, className = '', ...rest }: SelectProps) {
  return (
    <label className={`ds-select ${className}`}>
      <span className="ds-select-label">{label}</span>
      <select onChange={(event) => onChange(event.target.value)} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
