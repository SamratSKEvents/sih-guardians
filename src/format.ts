/**
 * How this console words and formats the things a slick record contains.
 *
 * It lives outside the components because the map card and the investigation
 * tab must say the same thing about the same record. Two copies of "Second
 * model agrees" is two places for it to drift into "Verified", which is a
 * claim the data does not support.
 */

/** Detector that produced the record. */
export const SOURCES: Record<string, string> = {
  EDGE: 'Edge segmenter detection',
  CERULEAN: 'Cerulean (SkyTruth) detection',
  CLEANSEANET: 'CleanSeaNet report',
  RECONSTRUCTION: 'Reconstructed slick',
};

/** The second opinion. Never phrased as a verdict on the slick itself. */
export const VERIFIER: Record<string, string> = {
  MULTI_MODEL_SUPPORTED: 'Second model agrees',
  LOOKALIKE_WARNING: 'Possible look-alike',
  CONCORDANT_NEGATIVE: 'Second model disagrees',
  SECOND_OPINION_UNAVAILABLE: 'No second opinion',
};

export const when = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const km2 = (m2: unknown) =>
  typeof m2 === 'number'
    ? `${(m2 / 1e6).toLocaleString('en-GB', { maximumFractionDigits: m2 < 1e6 ? 3 : 1 })} km²`
    : '—';

export const km = (m: unknown) =>
  typeof m === 'number' ? `${(m / 1e3).toLocaleString('en-GB', { maximumFractionDigits: m < 1e3 ? 2 : 1 })} km` : '—';

/** A coordinate as a person reads it off a chart, not as a signed float. */
export const degrees = (value: number, positive: string, negative: string) =>
  `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;

export const latLon = (centroid: unknown) =>
  Array.isArray(centroid) && typeof centroid[0] === 'number' && typeof centroid[1] === 'number'
    ? `${degrees(centroid[1], 'N', 'S')}, ${degrees(centroid[0], 'E', 'W')}`
    : '—';

/**
 * The tail of an id, for a tab strip that has ~90px to play with. The full id
 * is always shown in the panel itself; this is a handle, not an identifier.
 */
export const shortId = (id: string) => {
  const parts = id.split(/[:/]/).filter(Boolean);
  return parts[parts.length - 1] ?? id;
};
