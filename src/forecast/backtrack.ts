import type { SourceHypothesis } from '../incidents/types';

/** Available hindcast checkpoints for one windage case, oldest to newest. */
export function agesForScenario(hypotheses: readonly SourceHypothesis[] | undefined, scenario: string): number[] {
  return [...new Set((hypotheses ?? [])
    .filter((item) => item.scenario === scenario && Number.isFinite(item.ageHours) && item.ageHours > 0)
    .map((item) => item.ageHours))].sort((a, b) => a - b);
}

/** Hindcast support centers from the selected age back to the observation. */
export function selectBacktrackHypotheses(
  hypotheses: readonly SourceHypothesis[] | undefined,
  scenario: string,
  maxAgeHours: number,
): SourceHypothesis[] {
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) return [];
  return (hypotheses ?? [])
    .filter((item) => item.scenario === scenario && Number.isFinite(item.ageHours) && item.ageHours <= maxAgeHours)
    .sort((a, b) => b.ageHours - a.ageHours);
}
