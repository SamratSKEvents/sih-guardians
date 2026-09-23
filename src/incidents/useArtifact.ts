/**
 * Load one artifact of a bundle when the stage that needs it opens.
 *
 * Six stages each fetch a different file and each have the same three states
 * to render, so the dance lives here once. `'error'` is kept distinct from
 * "the artifact says UNAVAILABLE": the first means we do not know, the second
 * means the pipeline knows and the answer is no. DESIGN.md §6 — empty is not
 * failed — applies to loading too.
 */

import { useEffect, useState } from 'react';

export type Artifact<T> = T | 'error' | undefined;

export function useArtifact<T>(incidentId: string | undefined, load: (id: string) => Promise<T>): Artifact<T> {
  const [value, setValue] = useState<Artifact<T>>();

  useEffect(() => {
    if (!incidentId) {
      setValue(undefined);
      return;
    }
    let current = true;
    setValue(undefined);
    load(incidentId)
      .then((result) => current && setValue(result))
      .catch(() => current && setValue('error'));
    return () => {
      current = false;
    };
    // `load` is a module-level function per stage, stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidentId]);

  return value;
}
