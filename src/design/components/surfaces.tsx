/**
 * Surfaces.
 *
 * Panels float over the map as separate objects with real gaps between them.
 * That separation is doing work: a wall of hairline-divided rows reads as a
 * dump, the same content in spaced panels reads as an instrument. Gaps are
 * the cheapest credibility in the whole system.
 *
 * `Advanced` is the progressive-disclosure primitive. The console opens simple
 * and stays simple; every deeper control lives inside one of these, closed,
 * reachable at any time without selecting anything first.
 */

import { ChevronRight, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { IconButton } from './controls';
import type { Status } from './display';
import { InfoDot } from './filters';

/* ------------------------------------------------------------------- Panel */

export function Panel({
  title,
  subtitle,
  meta,
  variant = 'flush',
  collapsible,
  defaultOpen = true,
  onClose,
  footer,
  children,
}: {
  title: string;
  /** What the title names: an id, a coordinate. Sits under it, inside the
   *  heading, so the two never read as separate rows. */
  subtitle?: ReactNode;
  meta?: ReactNode;
  /** `float` sits over the map and gets elevation. `flush` sits in a layout. */
  variant?: 'float' | 'flush';
  collapsible?: boolean;
  defaultOpen?: boolean;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const shown = collapsible ? open : true;

  return (
    <section className={`ds-panel ds-panel-${variant}`}>
      <header className="ds-panel-head" data-subtitled={subtitle ? '' : undefined}>
        {collapsible ? (
          <button
            type="button"
            className="ds-panel-title ds-panel-trigger"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
          >
            <ChevronRight className="ds-caret" data-open={open} size={14} strokeWidth={2.25} />
            {title}
          </button>
        ) : (
          <h2 className="ds-panel-title">{title}</h2>
        )}
        {subtitle && <p className="ds-panel-subtitle">{subtitle}</p>}
        {meta && <span className="ds-panel-meta">{meta}</span>}
        {onClose && (
          <IconButton label={`Close ${title}`} onClick={onClose}>
            <X size={15} strokeWidth={2.25} />
          </IconButton>
        )}
      </header>
      {shown && (
        <div className="ds-panel-body" id={bodyId}>
          {children}
        </div>
      )}
      {shown && footer && <footer className="ds-panel-foot">{footer}</footer>}
    </section>
  );
}

/* ---------------------------------------------------------------- Advanced */

/**
 * Depth on demand.
 *
 * Closed by default and always present, so the simple view is the real view
 * and nothing is hidden behind a mode the operator has to discover. `count`
 * shows how much is inside without opening it.
 */
export function Advanced({
  label = 'Advanced',
  count,
  info,
  variant = 'inset',
  collapsible = true,
  defaultOpen,
  children,
}: {
  label?: string;
  count?: number;
  info?: string;
  /**
   * A section that is always open needs a heading, not a dead disclosure
   * button. The first block of a filter panel is usually this: nobody folds
   * away the thing they came to set.
   */
  collapsible?: boolean;
  /**
   * `inset` is a boxed disclosure inside a panel. `plain` is a section heading
   * inside a filter column: uppercase, no chrome, open by default. One
   * component either way, so a section can never drift from a disclosure in
   * behaviour.
   */
  variant?: 'inset' | 'plain';
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  // Plain sections open unless told otherwise; inset disclosures start closed.
  const [open, setOpen] = useState(defaultOpen ?? variant === 'plain');
  const bodyId = useId();
  const shown = collapsible ? open : true;

  const heading = (
    <>
      {collapsible && <ChevronRight className="ds-caret" data-open={open} size={14} strokeWidth={2.25} />}
      {label}
      {info && <InfoDot text={info} />}
      {count !== undefined && <span className="ds-advanced-count num">{count}</span>}
    </>
  );

  return (
    <div className={`ds-advanced ds-advanced-${variant} ${shown ? 'is-open' : ''}`}>
      {collapsible ? (
        <button
          type="button"
          className="ds-advanced-trigger"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          {heading}
        </button>
      ) : (
        <h3 className="ds-advanced-trigger is-static">{heading}</h3>
      )}
      {shown && (
        <div className="ds-advanced-body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Table */

export interface Column<Row> {
  key: string;
  header: string;
  /** Right-aligned and mono, for anything compared down a column. */
  numeric?: boolean;
  render: (row: Row) => ReactNode;
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
  selectedKey,
  onSelect,
  caption,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  selectedKey?: string;
  onSelect?: (row: Row) => void;
  caption: string;
}) {
  return (
    <div className="ds-table-scroll">
      <table className="ds-table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? 'is-numeric' : undefined}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                aria-selected={onSelect ? key === selectedKey : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect && (() => onSelect(row))}
                onKeyDown={
                  onSelect &&
                  ((event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onSelect(row);
                  })
                }
              >
                {/* mono on numerics: a right-aligned column is the one place
                  * digits genuinely stack, so alignment beats warmth there. */}
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric ? 'is-numeric mono' : undefined}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ Notice */

/**
 * An in-place message about the surface it sits in. Not a toast: nothing here
 * is transient enough to deserve one, and a warning that dismisses itself is
 * a warning that was not important.
 */
export function Notice({
  status = 'watch',
  title,
  children,
  action,
}: {
  status?: Status;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`ds-notice ds-notice-${status}`} role={status === 'critical' ? 'alert' : 'status'}>
      <div className="ds-notice-text">
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
