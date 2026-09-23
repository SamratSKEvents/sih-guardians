import type { AssessmentState, ConfidenceSummary, Exposure, Level, Sensitivity } from '../SitrepTypes';

const LEVELS: Level[] = ['UNAVAILABLE', 'LOW', 'LOW-MEDIUM', 'MEDIUM', 'MEDIUM-HIGH', 'HIGH'];
const STATES: AssessmentState[] = ['NOT_ASSESSABLE', 'INSUFFICIENTLY_CONSTRAINED', 'AMBIGUOUS', 'SUPPORTED'];

export const levelRank = (l: Level) => LEVELS.indexOf(l);
export const stateRank = (s: AssessmentState) => STATES.indexOf(s);
export const isState = (v: string): v is AssessmentState => (STATES as string[]).includes(v);
/** Rank within its own scale (levels and states are never compared with each other). */
export const confidenceRank = (v: Level | AssessmentState) => (isState(v) ? stateRank(v) : levelRank(v));

export const exposureRank = (e: Exposure) => ({ UNLIKELY: 1, POSSIBLE: 2, LIKELY: 3, CONFIRMED: 4 })[e];
export const sensitivityRank = (s: Sensitivity) => ({ LOW: 1, MODERATE: 2, HIGH: 3, 'VERY HIGH': 4, CRITICAL: 5 })[s];

/** Display label: "LOW-MEDIUM" → "LOW–MEDIUM", "INSUFFICIENTLY_CONSTRAINED" → "INSUFFICIENTLY CONSTRAINED". */
export const levelLabel = (v: Level | AssessmentState) => (v === 'UNAVAILABLE' ? 'NOT AVAILABLE' : v.replace(/_/g, ' ').replace('-', '–'));

export const CONFIDENCE_LABELS: Record<keyof ConfidenceSummary, string> = {
  observation: 'Observation',
  environmental: 'Environmental',
  hindcast: 'Hindcast',
  releaseTiming: 'Release timing',
  aisCoverage: 'AIS coverage',
  attribution: 'Attribution',
  forecast6h: 'Forecast +6 h',
  forecast24h: 'Forecast +24 h',
};

export function confidenceRows(c: ConfidenceSummary) {
  return (Object.keys(CONFIDENCE_LABELS) as (keyof ConfidenceSummary)[]).map((key) => ({ key, label: CONFIDENCE_LABELS[key], value: c[key] }));
}
