/**
 * The three states every asynchronous surface owes the user.
 *
 * These are components rather than a convention because the convention is what
 * gets skipped. A panel that only has a success state is a panel that shows a
 * blank rectangle when the backend is down.
 *
 * The distinction that matters in this app: `Empty` means the query ran and
 * the answer is nothing, which is information. `Failed` means we do not know.
 * Rendering "No slicks" when the request actually failed is a lie, and on an
 * operator console it is the dangerous kind.
 */

/* ---------------------------------------------------------------- Skeleton */

/**
 * Shaped like the content it replaces, so the panel does not resize when data
 * arrives. Static, not shimmering: a loop on every load is noise, and this
 * console reserves motion for things that changed.
 */
export function Skeleton({ rows = 3, head = false }: { rows?: number; head?: boolean }) {
  return (
    <div className="ds-skeleton" aria-hidden="true">
      {head && <span className="ds-skeleton-line" style={{ width: '52%', height: 18 }} />}
      {Array.from({ length: rows }, (_, index) => (
        <span
          key={index}
          className="ds-skeleton-line"
          /* Uneven widths: equal bars read as a loading graphic, not as text. */
          style={{ width: `${[88, 64, 76, 58, 81][index % 5]}%` }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Failed */

/**
 * We do not know. Carries the technical detail rather than hiding it: the
 * person reading this console is usually the person who can restart the
 * backend.
 */
export function Failed({
  title = 'Could not load',
  detail,
  onRetry,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="ds-state is-failed" role="alert">
      <p className="ds-state-title">{title}</p>
      {detail && <p className="ds-state-hint mono">{detail}</p>}
      {onRetry && (
        <button type="button" className="ds-button ds-button-default" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
