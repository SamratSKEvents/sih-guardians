/**
 * Incident state → validation → deterministic facts → narrative → SitrepDocument.
 * Renderers (JSON / Markdown / PDF) only format a SitrepDocument; they never read the incident state.
 */
import type { FactRow, SitrepDocument, SitrepFacts, SitrepIncidentState, SitrepVariant } from './SitrepTypes';
import { SITREP_CONFIG } from './SitrepConfig';
import { deriveActions, deriveGaps, rankResources } from './analysis/PriorityExtractor';
import { compareSitrepStates, toSnapshot } from './analysis/SitrepDeltaEngine';
import { confidenceRows, levelLabel } from './analysis/ConfidenceFormatter';
import { buildNarrative } from './narrative/NarrativeFormatter';
import { addHours, compass, fmt, reportingPeriod, utc } from './utils/format';

export class SitrepInputError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid SITREP input:\n - ${problems.join('\n - ')}`);
  }
}

/** Trust-boundary checks on the integration contract. */
export function validateSitrepState(s: SitrepIncidentState): void {
  const p: string[] = [];
  const iso = (v: string | null | undefined, name: string) => v != null && Number.isNaN(Date.parse(v)) && p.push(`${name} is not an ISO timestamp`);
  const i = s.incident;
  if (!i?.incidentId) p.push('incident.incidentId is required');
  if (!Number.isInteger(i?.sitrepNumber) || i.sitrepNumber < 1) p.push('incident.sitrepNumber must be an integer ≥ 1');
  if (!Number.isInteger(i?.revision) || i.revision < 0) p.push('incident.revision must be an integer ≥ 0');
  iso(i?.generatedAt, 'incident.generatedAt');
  iso(i?.reportingPeriodStart, 'incident.reportingPeriodStart');
  iso(i?.reportingPeriodEnd, 'incident.reportingPeriodEnd');
  if (i && Date.parse(i.reportingPeriodEnd) < Date.parse(i.reportingPeriodStart)) p.push('reporting period ends before it starts');
  if (i?.reportType === 'INITIAL' && s.previousSitrep) p.push('INITIAL SITREP cannot have a previousSitrep');
  if (s.previousSitrep && s.previousSitrep.sitrepNumber >= i.sitrepNumber) p.push('previousSitrep.sitrepNumber must be lower than incident.sitrepNumber');
  iso(s.observation?.observedAt, 'observation.observedAt');
  for (const [k, v] of [['slick.areaKm2', s.slick?.areaKm2], ['slick.lengthKm', s.slick?.lengthKm], ['slick.widthKm', s.slick?.widthKm]] as const) {
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) p.push(`${k} must be a non-negative number or null`);
  }
  const cov = s.vesselAssessment?.aisCoveragePct;
  if (cov != null && (cov < 0 || cov > 100)) p.push('vesselAssessment.aisCoveragePct must be 0–100');
  for (const c of s.vesselAssessment?.candidates ?? []) {
    if (!(c.supportScore >= 0 && c.supportScore <= 100)) p.push(`candidate ${c.id}: supportScore must be 0–100`);
    c.aisGaps.forEach((g, n) => Date.parse(g.to) < Date.parse(g.from) && p.push(`candidate ${c.id}: aisGaps[${n}] ends before it starts`));
  }
  for (const r of s.impacts?.resources ?? []) {
    if (r.exposureWindow && Date.parse(r.exposureWindow.end) < Date.parse(r.exposureWindow.start)) p.push(`resource ${r.id}: exposure window ends before it starts`);
  }
  for (const h of s.forecast?.horizons ?? []) {
    if (h.shorelineContactProbability !== null && (h.shorelineContactProbability < 0 || h.shorelineContactProbability > 1)) p.push(`forecast +${h.horizonH} h: shorelineContactProbability must be 0–1`);
  }
  for (const a of s.actions ?? []) if (!a.basis?.length) p.push(`action ${a.id}: basis is required (actions must be traceable)`);
  if (p.length) throw new SitrepInputError(p);
}

export function generateSitrep(s: SitrepIncidentState, opts: { variant?: SitrepVariant } = {}): SitrepDocument {
  validateSitrepState(s);
  const variant = opts.variant ?? 'FULL';
  const lim = SITREP_CONFIG.limits[variant];
  const i = s.incident, obs = s.observation, sl = s.slick, env = s.environment, va = s.vesselAssessment, fc = s.forecast;

  const snapshot = toSnapshot(s);
  const prev = s.previousSitrep?.snapshot ?? null;
  const deltas = prev ? compareSitrepStates(prev, snapshot) : [];
  const resources = rankResources(s);
  const relevant = [...va.candidates].sort((a, b) => b.supportScore - a.supportScore || a.id.localeCompare(b.id)).filter((c) => c.supportScore >= SITREP_CONFIG.vessels.minSupportScore);

  const row = (label: string, value: string, evidence: FactRow['evidence']): FactRow => ({ label, value, evidence });
  const envMissing = [env.windSpeedMs === null || env.windFromDeg === null, env.currentSpeedMs === null || env.currentTowardDeg === null];

  const facts: SitrepFacts = {
    header: {
      title: `${SITREP_CONFIG.systemTitle} ${SITREP_CONFIG.reportTitle}`,
      documentRef: `${i.incidentId}-SR${String(i.sitrepNumber).padStart(3, '0')}`,
      sitrepNo: String(i.sitrepNumber).padStart(3, '0'),
      incidentId: i.incidentId,
      revision: i.revision,
      reportType: i.reportType,
      lifecycle: i.lifecycle,
      reportingPeriod: reportingPeriod(i.reportingPeriodStart, i.reportingPeriodEnd),
      reportingPeriodStart: i.reportingPeriodStart,
      reportingPeriodEnd: i.reportingPeriodEnd,
      generatedAt: i.generatedAt,
      operationalStatus: `${i.operationalStatus} — ${i.assessmentState}`,
      assessmentState: i.assessmentState,
      preparedBy: i.preparedBy,
      reviewedBy: i.reviewedBy ?? 'NOT REVIEWED',
      classification: i.classification,
      distribution: i.distribution,
      region: i.subArea ? `${i.region} — ${i.subArea}` : i.region,
      systemName: i.systemName,
      modelVersion: i.modelVersion,
    },
    demonstration: i.isDemonstrationData,
    currentSituation: [
      row('Latest observation', `${utc(obs.observedAt)} — ${obs.platform} (${obs.sensor})`, 'OBSERVED'),
      row('Assessment', `${obs.classification} (detection confidence ${levelLabel(obs.detectionConfidence)})`, obs.classification.startsWith('CONFIRMED') ? 'OBSERVED' : 'UNCONFIRMED'),
      row('Location', sl.reference ? `${fmt.km(sl.reference.distanceKm, 0)} ${compass(sl.reference.bearingDeg)} of ${sl.reference.place}` : 'NOT AVAILABLE', 'OBSERVED'),
      row('Centroid', fmt.latLon(sl.centroid), 'OBSERVED'),
      row('Slick area', fmt.km2(sl.areaKm2), 'OBSERVED'),
      row('Length / width', sl.lengthKm === null && sl.widthKm === null ? 'NOT AVAILABLE' : `${fmt.km(sl.lengthKm)} / ${fmt.km(sl.widthKm)}`, 'OBSERVED'),
      row('Orientation', sl.orientationDeg === null ? 'NOT AVAILABLE' : `${fmt.bearing(sl.orientationDeg)} / ${fmt.bearing(sl.orientationDeg + 180)} (major axis)`, 'OBSERVED'),
      row('Fragmentation', sl.fragmentCount === null ? 'NOT AVAILABLE' : sl.fragmentCount <= 1 ? 'Single coherent slick' : `${sl.fragmentCount} separate regions`, 'OBSERVED'),
      row('Observation quality', `${levelLabel(obs.quality)}${obs.qualityNote ? ` — ${obs.qualityNote}` : ''}`, 'OBSERVED'),
    ],
    changes: { initial: !prev, previousSitrepNo: prev ? String(prev.sitrepNumber).padStart(3, '0') : null, deltas },
    environment: {
      assessment: envMissing.every(Boolean) ? 'UNAVAILABLE' : envMissing.some(Boolean) ? 'PARTIAL' : 'COMPLETE',
      rows: [
        row('Wind', env.windSpeedMs === null || env.windFromDeg === null ? 'NOT AVAILABLE' : `${fmt.ms(env.windSpeedMs)} from ${fmt.bearing(env.windFromDeg)}`, 'MODELLED'),
        row('Surface current', env.currentSpeedMs === null || env.currentTowardDeg === null ? 'NOT AVAILABLE' : `${fmt.ms(env.currentSpeedMs, 2)} toward ${fmt.bearing(env.currentTowardDeg)}`, 'MODELLED'),
        row('Significant wave height', fmt.m(env.waveHsM), 'MODELLED'),
        row('Stokes drift', env.stokesDriftMs === null || env.stokesTowardDeg === null ? 'NOT AVAILABLE' : `${fmt.ms(env.stokesDriftMs, 2)} toward ${fmt.bearing(env.stokesTowardDeg)}`, 'MODELLED'),
        row('Valid at', utc(env.validAt), 'OBSERVED'),
        row('Data quality', levelLabel(env.dataQuality), 'INFERRED'),
      ],
    },
    hindcast: {
      available: s.hindcast.available,
      state: s.hindcast.available ? s.hindcast.state : 'NOT_ASSESSABLE',
      corridor: s.hindcast.available ? s.hindcast.corridor : null,
      releaseWindowH: s.hindcast.available ? s.releaseAssessment.strongestWindowH : null,
      rows: s.hindcast.available
        ? [
            row('Hindcast period', s.hindcast.periodH === null ? 'NOT AVAILABLE' : `${fmt.hours(s.hindcast.periodH)} before observation`, 'MODELLED'),
            row('Source-support corridor', s.hindcast.corridor ? `${fmt.num(s.hindcast.corridor.minKm, 0)}–${fmt.km(s.hindcast.corridor.maxKm, 0)} ${compass(s.hindcast.corridor.bearingDeg)} of slick` : 'NOT CONSTRAINED', 'INFERRED'),
            row('Release interval', s.releaseAssessment.strongestWindowH ? `${fmt.hourRange(s.releaseAssessment.strongestWindowH)} before observation` : 'NOT CONSTRAINED', 'INFERRED'),
            row('Alternate interval', s.releaseAssessment.alternateWindowH ? `${fmt.hourRange(s.releaseAssessment.alternateWindowH)} before observation` : 'NONE', 'INFERRED'),
            row('Uncertainty', levelLabel(s.hindcast.uncertainty), 'INFERRED'),
            row('Assessment', levelLabel(s.hindcast.state), 'INFERRED'),
          ]
        : [],
      limitations: s.hindcast.limitations,
    },
    vessels: {
      aisAvailable: va.aisAvailable,
      aisCoveragePct: va.aisAvailable ? va.aisCoveragePct : null,
      vesselsScreened: va.vesselsScreened,
      attributionState: va.attributionState,
      candidates: va.aisAvailable ? relevant.slice(0, SITREP_CONFIG.vessels.maxCandidates) : [],
      omittedCount: va.aisAvailable ? Math.max(0, va.candidates.length - Math.min(relevant.length, SITREP_CONFIG.vessels.maxCandidates)) : 0,
    },
    forecast: {
      available: fc.available,
      issuedAt: fc.issuedAt,
      model: fc.model,
      horizons: fc.available && fc.issuedAt ? fc.horizons.map((h) => ({ ...h, validAt: addHours(fc.issuedAt!, h.horizonH) })) : [],
    },
    impacts: { resources: resources.slice(0, lim.resources), shorelineImpactObserved: s.impacts.shorelineImpactObserved },
    alerts: snapshot.alerts,
    actions: deriveActions(s, resources).slice(0, lim.actions),
    gaps: deriveGaps(s).slice(0, lim.gaps),
    confidence: confidenceRows(s.confidence),
    evidenceBasis: evidenceBasis(s),
    provenance: [
      ...s.provenance.datasets.map((d) => ({ label: d.label, value: d.source ?? 'NOT AVAILABLE' })),
      { label: 'Model configuration', value: s.provenance.modelConfiguration },
    ],
    geometry: {
      slickCentroid: sl.centroid,
      slickOutline: sl.outline?.length ? sl.outline : null,
      coastline: fc.coastline?.length ? fc.coastline : null,
      corridorPolygon: s.hindcast.available && s.hindcast.corridorPolygon?.length ? s.hindcast.corridorPolygon : null,
      tracks: va.aisAvailable ? relevant.slice(0, SITREP_CONFIG.vessels.maxCandidates).filter((c) => c.track?.length).map((c) => ({ id: c.id, points: c.track! })) : [],
    },
  };
  // FLASH keeps only the most operationally significant changes.
  // FLASH: the alert block already shows current alerts, so NEW-alert deltas are dropped; UNCHANGED facts are omitted.
  if (variant === 'FLASH') facts.changes.deltas = deltas.filter((d) => d.kind !== 'UNCHANGED' && !(d.kind === 'NEW' && d.category === 'ALERT')).slice(0, lim.deltas);
  else facts.changes.deltas = deltas.slice(0, lim.deltas);

  return { schema: 'guardians-sitrep/1', variant, facts, narrative: buildNarrative(facts, prev, snapshot), snapshot };
}

/** OBSERVED / MODELLED / INFERRED / UNCONFIRMED — built from what is actually present in the state. */
function evidenceBasis(s: SitrepIncidentState): SitrepFacts['evidenceBasis'] {
  const obs = s.observation, va = s.vesselAssessment;
  const observed = [`${obs.sensor} dark feature (${utc(obs.observedAt)})`];
  if (s.slick.areaKm2 !== null) observed.push('Slick geometry: area, length, orientation');
  if (va.aisAvailable) observed.push(`AIS vessel positions (coverage ${fmt.pct(va.aisCoveragePct)})`);
  if (obs.independentObservation) observed.push(`${obs.independentObservation.sensor}: ${obs.independentObservation.result}`);

  const modelled: string[] = [];
  if (s.forecast.available) modelled.push(`Forward drift trajectories (+${s.forecast.horizons.map((h) => h.horizonH).join(' / +')} h)`);
  if (s.hindcast.available) modelled.push('Hindcast particle trajectories');
  if (s.environment.currentSpeedMs !== null) modelled.push('Surface currents and wave forcing');

  const inferred: string[] = [];
  if (s.hindcast.available && s.hindcast.corridor) inferred.push('Possible source corridor');
  if (s.releaseAssessment.strongestWindowH) inferred.push('Release time window');
  if (va.aisAvailable && va.candidates.length) inferred.push('Candidate analytical-support ranking');
  if (s.impacts.resources.length) inferred.push('Resource exposure windows');

  const unconfirmed: string[] = [];
  if (!obs.classification.startsWith('CONFIRMED')) unconfirmed.push('Presence of oil');
  if (obs.oilComposition === null) unconfirmed.push('Oil composition');
  if (!s.slick.thicknessAvailable) unconfirmed.push('Slick thickness / volume');
  if (!va.externalConfirmation) unconfirmed.push('Vessel responsibility');
  if (s.impacts.shorelineImpactObserved !== true) unconfirmed.push('Shoreline impact');

  return { OBSERVED: observed, MODELLED: modelled, INFERRED: inferred, UNCONFIRMED: unconfirmed };
}
