import { describe, expect, it } from 'vitest';
import type { SourceHypothesis } from '../src/incidents/types';
import { agesForScenario, selectBacktrackHypotheses } from '../src/forecast/backtrack';
import sourceHypotheses from '../public/data/incidents/gulf-of-kutch-04471/source-hypotheses.json';

const samples: SourceHypothesis[] = [
  { scenario: 'windage_0%', ageHours: 3, time: 't-3', centre: { lon: 1, lat: 1 }, spreadRadiusKm: 2, particleCount: 256, interpretation: 'support' },
  { scenario: 'windage_0%', ageHours: 9, time: 't-9', centre: { lon: 2, lat: 2 }, spreadRadiusKm: 3, particleCount: 256, interpretation: 'support' },
  { scenario: 'windage_0%', ageHours: 24, time: 't-24', centre: { lon: 3, lat: 3 }, spreadRadiusKm: 4, particleCount: 256, interpretation: 'support' },
  { scenario: 'windage_3%', ageHours: 6, time: 't-6', centre: { lon: 4, lat: 4 }, spreadRadiusKm: 2, particleCount: 256, interpretation: 'support' },
];

describe('source backtrack selection', () => {
  it('sorts available checkpoints oldest to newest and excludes other windage cases', () => {
    expect(agesForScenario(samples, 'windage_0%')).toEqual([3, 9, 24]);
    expect(agesForScenario(samples, 'missing')).toEqual([]);
  });

  it('scrubs the chosen case to the selected age without inventing checkpoints', () => {
    expect(selectBacktrackHypotheses(samples, 'windage_0%', 10).map(({ ageHours }) => ageHours)).toEqual([9, 3]);
    expect(selectBacktrackHypotheses(samples, 'windage_3%', 5)).toEqual([]);
    expect(selectBacktrackHypotheses(undefined, 'windage_0%', 24)).toEqual([]);
  });

  it('exposes all bundled 24-hour windage scenarios at their stored checkpoints', () => {
    const bundle = sourceHypotheses as { scenarios: string[]; hypotheses: SourceHypothesis[] };
    expect(bundle.scenarios).toHaveLength(4);
    for (const scenario of bundle.scenarios) {
      expect(agesForScenario(bundle.hypotheses, scenario)).toEqual([3, 6, 9, 12, 18, 24]);
      expect(selectBacktrackHypotheses(bundle.hypotheses, scenario, 12).map(({ ageHours }) => ageHours)).toEqual([12, 9, 6, 3]);
    }
  });
});
