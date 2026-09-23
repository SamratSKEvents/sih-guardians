/**
 * What is missing, why, and what would fix it.
 *
 * The old surface printed "Cannot be answered for this detection" three times
 * and then a column of the word `absent`. Both are true and neither is useful:
 * an operator looking at a blank Origin stage needs to know whether the drift
 * was never run, or could not be run, or was run and came back too wide to
 * mean anything — and what to go and get.
 *
 * Every bundle already answers that. `{status, reason, detail}` travels with
 * every artifact, `detail` is a sentence the pipeline wrote about its own run,
 * and it is better than anything this file could compose, so it is printed
 * verbatim rather than summarised.
 *
 * One component for every one of those cases, so a missing dataset cannot
 * start looking like a broken one.
 */

import type { ReactNode } from 'react';
import { Notice } from '../../design/components';
import type { Stated } from '../../incidents/types';
import { REASON_LABEL, say } from '../../incidents/words';

/** `PARTIAL` still has an answer, so it is a caveat above the content. */
export function Caveat({ of, children }: { of: Stated | undefined; children?: ReactNode }) {
  if (!of || of.status === 'AVAILABLE' || of.status === 'SUPPORTED' || !of.detail) return null;
  return (
    <Notice status="warning" title={say(REASON_LABEL, of.reason) ?? 'Read this with the answer'}>
      {of.detail}
      {children}
    </Notice>
  );
}

export function Gap({
  title,
  of,
  /** The inputs this stage needs, ticked against what the record carries. */
  needs,
  children,
}: {
  title: string;
  of?: Stated;
  needs?: readonly { label: string; has: boolean }[];
  children?: ReactNode;
}) {
  const why = say(REASON_LABEL, of?.reason);
  return (
    <div className="gap">
      <Notice status="inactive" title={title}>
        {of?.detail ?? why ?? 'This detection carries none of the inputs this stage needs.'}
        {children}
      </Notice>

      {needs && needs.length > 0 && (
        <ul className="gap-needs">
          {needs.map((need) => (
            <li key={need.label} data-has={need.has || undefined}>
              <span className="gap-mark" aria-hidden="true" />
              {need.label}
              <span className="gap-state">{need.has ? 'present' : 'missing'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The loading and failure states a stage shares.
 *
 * Kept beside `Gap` on purpose: "still fetching", "the fetch failed" and "the
 * pipeline says no" are three different sentences and this console must never
 * render one of them for another.
 */
export function Unreachable({ what }: { what: string }) {
  return (
    <Notice status="critical" title="Could not load this part of the investigation">
      {what} did not come back. This is a fault here, not a gap in the record: the answer may exist.
    </Notice>
  );
}
