/** Thresholds and limits. Every value that decides "is this worth reporting" lives here. */
export const SITREP_CONFIG = {
  systemTitle: 'GUARDIANS',
  reportTitle: 'MARITIME POLLUTION SITUATION REPORT',

  change: {
    /** Slick area change is reported when BOTH relative and absolute thresholds are exceeded. */
    areaPct: 5,
    areaKm2: 0.3,
    centroidKm: 1.0,
    forecastCentreKm: 1.0,
    supportPoints: 3,
    aisCoveragePts: 3,
    exposureOnsetH: 1,
    /** Dataset age (h) above which a dataset counts as stale, per dataset. */
    staleAgeH: { SAR: 12, WIND: 6, CURRENTS: 12, WAVES: 12, AIS: 6, MODEL: 24 } as Record<string, number>,
  },

  alerts: {
    /** Resources whose exposure window opens within this many hours of report time raise an alert. */
    approachWithinH: 24,
    aisCoverageMinPct: 80,
  },

  vessels: {
    maxCandidates: 3,
    minSupportScore: 50,
  },

  limits: {
    FULL: { actions: 6, resources: 4, gaps: 8, deltas: 24 },
    FLASH: { actions: 3, resources: 2, gaps: 4, deltas: 5 },
  },
} as const;
