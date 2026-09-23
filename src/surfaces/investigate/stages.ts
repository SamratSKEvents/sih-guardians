/**
 * The six stages of an investigation, and what each one needs.
 *
 * They are a chain, not a set of tabs. PRODUCT.md's four questions have to be
 * answered in order and each is only as good as the last: a source region
 * built on a drift run with no current field is not a weaker source region,
 * it is not one. So the rail is numbered, the stages carry their own state,
 * and a stage whose inputs are missing says which.
 *
 * `needs` names keys of `incident.coverage`. That map is the pipeline's own
 * account of what it had, which is why the rail can distinguish "not built
 * yet" from "could not be computed for this detection" without guessing.
 */

import type { Coverage, Incident, State } from '../../incidents/types';

/** Which tab a stage belongs to. */
export type StageGroup = 'detection' | 'temporal' | 'response';

export interface Stage {
  id: string;
  /**
   * Four tabs, not seven peers. What was seen; how it moves through time,
   * backwards and forwards; what it reaches; and what is done about it. Each
   * tab's first stage is the one it opens on.
   */
  group: StageGroup;
  label: string;
  /** What the stage answers, in the operator's words. */
  asks: string;
  /** Coverage keys this stage cannot run without. */
  needs: readonly string[];
}

export const STAGES: readonly Stage[] = [
  {
    id: 'detection',
    group: 'detection',
    label: 'Detection',
    asks: 'What was actually observed?',
    needs: ['detection'],
  },
  {
    id: 'origin',
    group: 'temporal',
    label: 'Origin',
    asks: 'Where could it have come from, and when?',
    needs: ['backtrack', 'sourceRegion'],
  },
  {
    id: 'vessels',
    group: 'response',
    label: 'Vessels',
    asks: 'Who could be associated with it?',
    needs: ['ais', 'attribution'],
  },
  {
    id: 'forecast',
    group: 'temporal',
    label: 'Forecast',
    asks: 'Where is it going?',
    needs: ['forecast'],
  },
  {
    id: 'response',
    group: 'response',
    label: 'Response',
    asks: 'So what do we do?',
    needs: ['forecast', 'consequence'],
  },
];

const RANK: Record<State, number> = {
  UNAVAILABLE: 0,
  // "Could not be assessed" is as weak as "not there": either way the stage
  // downstream of it has nothing to stand on.
  NOT_ASSESSABLE: 0,
  AMBIGUOUS: 1,
  INTERPOLATED: 2,
  PARTIAL: 2,
  SUPPORTED: 3,
  AVAILABLE: 3,
};

/**
 * A stage is only as strong as its weakest input — the chain rule, applied.
 * With no incident bundle every stage past Detection is simply unavailable.
 */
export function stageState(stage: Stage, incident: Incident | undefined): State {
  if (!incident) return stage.id === 'detection' ? 'PARTIAL' : 'UNAVAILABLE';
  if (stage.needs.length === 0) return 'AVAILABLE';

  const rows = stage.needs.map((key) => incident.coverage.find((row) => row.key === key));
  // A need the coverage map has no row for is not silently a pass.
  if (rows.some((row) => !row)) return 'UNAVAILABLE';
  return (rows as Coverage[]).reduce<State>(
    (worst, row) => (RANK[row.state] < RANK[worst] ? row.state : worst),
    'AVAILABLE',
  );
}

/** The coverage rows a stage is waiting on, for its gap panel. */
export const missingFor = (stage: Stage, incident: Incident | undefined): Coverage[] =>
  incident
    ? stage.needs
        .map((key) => incident.coverage.find((row) => row.key === key))
        .filter((row): row is Coverage => !!row && row.state === 'UNAVAILABLE')
    : [];
