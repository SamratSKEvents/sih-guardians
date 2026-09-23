/**
 * Planning configuration. Every value that decides "how long", "how early" or "how much" lives here and is surfaced
 * in the plan as a PLANNING ASSUMPTION — none of these are operating limits (those come only from asset data).
 */
import type { Activity } from './IapTypes';

export const IAP_CONFIG = {
  systemTitle: 'GUARDIANS',
  documentTitle: 'INCIDENT ACTION PLAN',

  authorityNotice:
    'DECISION-SUPPORT DRAFT. Operational assignments require authorization by the designated incident command authority. ' +
    'Nothing in this plan is an issued order.',

  scheduling: {
    /** Start-time search step (min). */
    stepMin: 15,
  },

  /** Planning durations (min) on scene, excluding transit. Surfaced as assumption ASM-DUR. */
  durationsMin: {
    SAFETY_BRIEF: 30,
    NOTIFICATION: 30,
    INFORMATION_REQUEST: 45,
    SURVEILLANCE_AIR: 60,
    SURVEILLANCE_DRONE: 90,
    SURVEILLANCE_VESSEL: 120,
    SAMPLING_OFFSHORE: 150,
    SAMPLING_NEARSHORE: 90,
    PROTECTION_STAGING: 90,
    SENSOR_INSTALL: 45,
    CONTAINMENT_READINESS: 60,
    SHORELINE_PREASSESSMENT: 120,
    EVIDENCE_RECORD: 60,
  },

  priority: {
    /** Resources whose exposure window opens within period start + lookahead are planned for this period. */
    lookaheadH: 36,
  },

  reporting: {
    vesselStatusMin: 60,
    aircraftStatusMin: 30,
    fieldTeamStatusMin: 120,
    boundaryReportAfterMin: 30,
    /** Command prepares the next IAP this long before period end. */
    nextIapLeadMin: 60,
  },

  /** Minutes after period start at which an unresolved boom shortfall is escalated for external support. */
  boomEscalationAfterMin: 120,

  /** Activities whose units work on the water, in the air or on the shoreline: safety coverage is mandatory. */
  fieldActivities: ['SURVEILLANCE_AIR', 'SURVEILLANCE_DRONE', 'SURVEILLANCE_VESSEL', 'PROTECTION', 'CONTAINMENT', 'SAMPLING', 'SHORELINE', 'MONITORING'] as Activity[],

  limits: {
    QUICK: { objectives: 6, assignments: 14, triggers: 4, gaps: 4, hazards: 3, deltas: 8 },
    FULL: { objectives: 20, assignments: 40, triggers: 20, gaps: 20, hazards: 20, deltas: 26 },
  },
} as const;
