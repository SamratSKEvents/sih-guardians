/**
 * What the pipeline's enums are called in front of a person.
 *
 * `format.ts` does this for the slick record; this does it for the incident
 * bundle, and for the same reason: a screen that prints
 * `NO_ATTRIBUTION_INPUTS` is showing the operator a variable name. It sits
 * beside the types rather than in `format.ts` because nothing outside the
 * investigation workspace reads a bundle.
 *
 * A code with no entry falls back to sentence-casing it, so a new pipeline
 * code degrades to readable rather than to a crash or to a blank.
 */

import type { Status } from '../design/components';
import type { State } from './types';

const sentence = (code: string) => {
  // SCREAMING_SNAKE and camelCase both arrive here: the pipeline writes its
  // codes one way and its raw measurement keys the other.
  const words = code
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** A raw measurement key (`minSourceRegionDistanceKm`) in words. */
export const readable = (key: string) => sentence(key);

/** How far an answer got, in words. */
const STATE_LABELS: Record<State, string> = {
  AVAILABLE: 'Available',
  SUPPORTED: 'Supported',
  PARTIAL: 'Partial',
  INTERPOLATED: 'Interpolated',
  AMBIGUOUS: 'Ambiguous',
  NOT_ASSESSABLE: 'Not assessable',
  UNAVAILABLE: 'Not available',
};

/**
 * Which status hue a state takes.
 *
 * `AVAILABLE` and `SUPPORTED` are `clear`; `PARTIAL`, `INTERPOLATED` and
 * `AMBIGUOUS` are `warning` — they carry an answer AND a caveat, and the
 * caveat is the point. `UNAVAILABLE` is `inactive`, never `critical`: a
 * missing dataset is not an emergency, and spending the red on it would leave
 * nothing for one.
 */
const STATE_STATUSES: Record<State, Status> = {
  AVAILABLE: 'clear',
  SUPPORTED: 'clear',
  PARTIAL: 'warning',
  INTERPOLATED: 'warning',
  AMBIGUOUS: 'warning',
  NOT_ASSESSABLE: 'inactive',
  UNAVAILABLE: 'inactive',
};

/*
 * Both lookups are functions, not the bare tables, and that is the fix for a
 * real crash rather than a style choice. `NOT_ASSESSABLE` was a state four of
 * the bundles emit and this file did not list, so `STATE_LABEL[state]` came
 * back undefined and the header threw on `.toLowerCase()`. A pipeline enum is
 * an open set — it grows when the pipeline does — so an unrecognised state now
 * degrades to a readable word and the cautious hue, and can never take the
 * workspace down with it.
 */

/** How far an answer got, in words. Unknown states degrade, never throw. */
export const STATE_LABEL = (state: State | string | undefined): string =>
  (state && STATE_LABELS[state as State]) || (state ? sentence(state) : 'Unknown');

/** The hue a state takes. Anything unrecognised is treated as not available. */
export const STATE_STATUS = (state: State | string | undefined): Status =>
  (state && STATE_STATUSES[state as State]) || 'inactive';

/** Reason codes the bundles actually emit. */
export const REASON_LABEL: Record<string, string> = {
  NO_ATTRIBUTION_INPUTS: 'No acquisition time, AIS coverage or environmental forcing',
  NO_ACQUISITION_METADATA: 'The scene carries no acquisition timestamp',
  NO_SAR_SCENE_RECOVERED: 'The SAR scene was not recovered',
  NO_PROBABILITY_RASTER_RECOVERED: 'No probability raster was recovered',
  NO_SOURCE_SUPPORT_RASTER_RECOVERED: 'No source-support raster was recovered',
  NO_FORECAST_FOOTPRINT_ARTIFACT: 'The forward run produced a track, not a footprint',
  NO_SENSITIVE_AREA_DATASET: 'No coastline or protected-area dataset is connected',
  FORCING_COVERAGE_EXCEEDED: 'Beyond the forcing data’s coverage',
  NOT_AVAILABLE_AT_GFW_RESOLUTION: 'Not carried by the gridded AIS product',
  OBSERVED_POLYGON_UNAVAILABLE_RECONSTRUCTED_FROM_VERIFIED_DATA: 'No observed polygon; reconstructed instead',
  NO_DETECTION_ARTIFACT: 'No detection artifact for this incident',
  NO_SOURCE_HYPOTHESES_ARTIFACT: 'No source-hypothesis artifact for this incident',
  NO_CANDIDATE_ARTIFACT: 'No candidate ranking for this incident',
  NO_AIS_ARTIFACT: 'No AIS coverage for this incident',
  NO_FORECAST_ARTIFACT: 'No forward run for this incident',
  NO_ENVIRONMENTAL_ARTIFACT: 'No environmental forcing for this incident',
  NO_EVENT_ARTIFACT: 'No event record for this incident',
  NO_PROVENANCE_ARTIFACT: 'No provenance record for this incident',
  NO_POSTHOC_ARTIFACT: 'No post-hoc analysis for this incident',
};

/** How a detection's geometry was arrived at. */
export const GEOMETRY_LABEL: Record<string, string> = {
  POLYGON: 'Outline',
  POINT_ONLY: 'Reported point only',
  POINT_ONLY_NO_SOURCE_POLYGON: 'Reported point only, no outline recovered',
  RECONSTRUCTED: 'Reconstructed outline',
};

/** Where a slick's outline came from (the record's `gsrc`). */
export const GEOMETRY_SOURCE: Record<string, string> = {
  ISOLINE: 'Traced from the probability raster',
  SUPPLIED_VECTOR: 'Supplied by the source catalogue',
  SCIENTIFIC_FALLBACK: 'Full-resolution fallback outline',
  NONE_POINT_ONLY: 'None — point only',
  RECONSTRUCTION: 'Reconstructed from parts',
};

/** How a record was classified (the record's `classification`). */
export const CLASSIFICATION_LABEL: Record<string, string> = {
  AI_DERIVED: 'Segmented by model',
  OBSERVED_CATALOG: 'From a source catalogue',
  RECONSTRUCTED: 'Reconstructed',
};

/** The four questions, as the provenance record keys them. */
export const QUESTION_LABEL: Record<string, string> = {
  WHAT: 'What is it?',
  WHERE: 'Where is it?',
  WHEN: 'When was it seen?',
  WHO: 'Who could be associated?',
  FUTURE: 'Where is it going?',
};

/** A score component, in the vocabulary the ranking itself documents. */
export const COMPONENT_LABEL: Record<string, string> = {
  proximity: 'Proximity',
  temporality: 'Timing',
  parity: 'Direction',
  spatial: 'Proximity',
  temporal: 'Timing',
  direction: 'Direction',
  trajectory: 'Trajectory',
  evidence: 'Evidence',
};

/** Where a component's value came from. */
export const ORIGIN_LABEL: Record<string, string> = {
  audit: 'Recomputed from the source data',
  artifact: 'Read from the frozen run',
};

/** A pipeline code in words, sentence-cased if it is one we have not met. */
export const say = (table: Record<string, string>, code: string | null | undefined) =>
  code ? (table[code] ?? sentence(code)) : undefined;
