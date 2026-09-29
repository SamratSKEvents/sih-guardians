/**
 * Incident bundles.
 *
 * These are static files under `/data/incidents/<id>/`, not an API: a bundle is
 * frozen output, identical on every request. The prototype ships these as
 * local static assets and loads only the artifact needed by the open stage.
 *
 * Each artifact is fetched on its own, when the stage that needs it opens.
 * A workspace that pulled the whole bundle up front would spend 7 MB to draw a
 * header.
 *
 * A missing file is not an error here. When the pipeline did not produce an
 * artifact, `loadArtifact` returns `{status: 'UNAVAILABLE'}` for the UI.
 */

import type {
  Ais,
  Candidates,
  Detection,
  Environment,
  Incident,
  Posthoc,
  Provenance,
  SourceHypotheses,
  Stated,
} from '../incidents/types';
import type { SlickFeature } from './slicks';

/**
 * Catalog scene id to bundle. Only the flagship record carries a full investigation;
 * a literal map is the whole join, and it fails loudly if a bundle is renamed.
 */
const BY_SCENE: Record<string, string> = {
  'oil:00000': 'terramind-oil-00000',
  'oil:00005': 'terramind-oil-00005',
  'oil:00010': 'terramind-oil-00010',
  'CleanSeaNet 2021_83_1': 'cleanseanet-2021-83-1',
  S1A_IW_GRDH_1SDV_20260314T061208_053012: 'gulf-of-kutch-04471',
};

/** The bundle for this slick, or undefined: most records have none. */
export function resolveIncidentId(slick: SlickFeature): string | undefined {
  const scene = slick.properties.scene;
  return typeof scene === 'string' ? BY_SCENE[scene] : undefined;
}

const base = (incidentId: string) => `/data/incidents/${encodeURIComponent(incidentId)}`;

export const fetchIncident = async (incidentId: string): Promise<Incident> => {
  const response = await fetch(`${base(incidentId)}/incident.json`);
  if (!response.ok) throw new Error(`incident ${incidentId}: HTTP ${response.status}`);
  return response.json() as Promise<Incident>;
};

/**
 * One artifact of a bundle. A 404 is data, not a failure: it means the
 * pipeline emitted nothing for this incident, which is exactly what the
 * `UNAVAILABLE` state says. Anything else is a real fault and propagates.
 */
async function loadArtifact<T extends Stated>(incidentId: string, file: string, reason: string): Promise<T> {
  const response = await fetch(`${base(incidentId)}/${file}`);
  if (response.status === 404) {
    return { status: 'UNAVAILABLE', reason, detail: null } as T;
  }
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const fetchDetection = (id: string) =>
  loadArtifact<Detection>(id, 'detection.json', 'NO_DETECTION_ARTIFACT');

export const fetchSourceHypotheses = (id: string) =>
  loadArtifact<SourceHypotheses>(id, 'source-hypotheses.json', 'NO_SOURCE_HYPOTHESES_ARTIFACT');

export const fetchCandidates = (id: string) =>
  loadArtifact<Candidates>(id, 'candidates.json', 'NO_CANDIDATE_ARTIFACT');

export const fetchAis = (id: string) => loadArtifact<Ais>(id, 'ais.json', 'NO_AIS_ARTIFACT');

export const fetchEnvironment = (id: string) =>
  loadArtifact<Environment>(id, 'environment.json', 'NO_ENVIRONMENTAL_ARTIFACT');

export const fetchProvenance = (id: string) =>
  loadArtifact<Provenance>(id, 'provenance.json', 'NO_PROVENANCE_ARTIFACT');

export const fetchPosthoc = (id: string) =>
  loadArtifact<Posthoc>(id, 'posthoc.json', 'NO_POSTHOC_ARTIFACT');

