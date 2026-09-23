/**
 * Stage ③ — who could be associated with it.
 *
 * This is the stage with the most ways to go wrong, so it is the stage that
 * shows the most of its working. A ranked list of ships beside a slick reads
 * as an accusation whatever the header says, and the only defence is to put
 * the arithmetic on screen: every candidate's score breaks into its weighted
 * terms, each term carries the raw quantity behind it, and each says whether
 * it was recomputed here or read from the frozen run.
 *
 * Two facts about this ranking matter more than its order, and both are in
 * the artifact rather than added by this file: the weights were never tuned,
 * and vessel identity was never a ranking feature. The names were attached
 * after the ranking was frozen. Without that, a demo of this stage is a demo
 * of circular reasoning.
 *
 * Selecting a candidate isolates its track instead of opening another page,
 * because the comparison the operator is making is against the source region,
 * which has to stay on screen.
 */

import { useState } from 'react';
import { Badge, Field, FieldList, Meter, Notice, Panel, Search, Table } from '../../../design/components';
import { fetchAis, fetchCandidates, fetchSourceHypotheses } from '../../../api/incidents';
import { useArtifact } from '../../../incidents/useArtifact';
import type { Ais, Candidate, Candidates, SourceHypotheses } from '../../../incidents/types';
import { COMPONENT_LABEL, ORIGIN_LABEL, readable, say } from '../../../incidents/words';
import { Caveat, Gap, Unreachable } from '../Gap';
import { CesiumChart } from '../CesiumChart';
import { aroundKm, extentOf, type MapLayer } from '../chart-types';
import { slickLayer } from '../geometry';
import { missingFor, STAGES } from '../stages';
import type { StageProps } from '../Workspace';
import { StageFrame } from '../StageFrame';

const STAGE = STAGES.find((item) => item.id === 'vessels')!;
/** 610 tracks at once is a hairball. The list stays complete; the chart does not. */
const DRAWN = 40;

export function VesselsStage({ slick, incident, incidentId }: StageProps) {
  const candidates = useArtifact<Candidates>(incidentId, fetchCandidates);
  const ais = useArtifact<Ais>(incidentId, fetchAis);
  const hypotheses = useArtifact<SourceHypotheses>(incidentId, fetchSourceHypotheses);
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState('');

  if (!incidentId) {
    return (
      <Gap
        title="No vessel can be considered for this detection"
        needs={[
          { label: 'Slick geometry', has: true },
          { label: 'Reconstructed source region', has: false },
          { label: 'AIS coverage', has: false },
        ]}
      >
        {' '}
        A candidate is a vessel that crossed the reconstructed source region inside the supported time range. With no
        reconstruction there is no region to cross, so there is nothing to rank — not a short list, none.
      </Gap>
    );
  }

  if (candidates === 'error') return <Unreachable what="The candidate ranking" />;
  if (!candidates) return <p className="stage-wait">Loading the candidate ranking…</p>;

  if (candidates.status === 'UNAVAILABLE' || !candidates.candidates?.length) {
    return (
      <Gap
        title="No candidate ranking was produced"
        of={candidates}
        needs={missingFor(STAGE, incident).map((row) => ({ label: row.label, has: false }))}
      />
    );
  }

  const all = candidates.candidates;
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? all.filter(
        (c) =>
          c.identity.name?.toLowerCase().includes(needle) ||
          c.identity.mmsi?.includes(needle) ||
          c.identity.flag?.toLowerCase().includes(needle),
      )
    : all.slice(0, 50);

  const chosen = all.find((c) => c.candidateId === selected);
  const tracks = ais !== 'error' && ais?.tracks ? ais.tracks : [];
  const chosenTrack = chosen ? tracks.find((t) => t.vesselId === chosen.vesselId) : undefined;

  /* The chart: the source region, then either every drawn track quietly, or
   * the one selected track and nothing else competing with it. */
  const drawn = chosenTrack ? [chosenTrack] : tracks.slice(0, DRAWN);
  /*
   * One windage scenario's worth of source region, not all four.
   *
   * Origin is where the four are compared; here the region is context for the
   * tracks, and drawing 24 overlapping ellipses buried the thing this stage is
   * actually about. Comparing scenarios is stage ②'s job.
   */
  const everySupport = hypotheses !== 'error' ? (hypotheses?.hypotheses ?? []) : [];
  const baseScenario = hypotheses !== 'error' ? hypotheses?.scenarios?.[0] : undefined;
  const support = baseScenario
    ? everySupport.filter((h) => h.scenario === baseScenario)
    : everySupport;

  const layers: MapLayer[] = [];
  if (support.length > 0) {
    layers.push({
      id: 'support',
      label: 'Source-support regions',
      claim: 'reconstructed',
      shapes: support.map((h) => ({ kind: 'circle', centre: h.centre, radiusKm: h.spreadRadiusKm, tone: 'muted' })),
    });
  }
  layers.push({
    id: 'tracks',
    label: chosenTrack ? 'Selected vessel track' : `Vessel tracks (${drawn.length} of ${tracks.length})`,
    claim: 'observed',
    shapes: drawn.map((track) => ({
      kind: 'path',
      points: track.points,
      tone: chosenTrack ? 'select' : 'vessel',
      width: chosenTrack ? 2.25 : 1,
    })),
  });
  if (incident) {
    layers.push({
      id: 'observed',
      label: 'Observed position',
      claim: 'observed',
      shapes: [{ kind: 'point', at: incident.centre, tone: 'slick', radius: 4.5 }],
    });
  }
  // The thing under investigation, on the chart that is about it.
  const outline = slickLayer(slick.geometry);
  if (outline) layers.unshift(outline);


  const extent = extentOf(
    [
      ...support.flatMap((h) => aroundKm(h.centre, h.spreadRadiusKm)),
      ...(incident ? [incident.centre] : []),
      ...(chosenTrack ? chosenTrack.points : []),
    ],
    incident?.centre ?? { lon: 0, lat: 0 },
    0.2,
  );

  return (
    <StageFrame
      chart={
      <CesiumChart
        extent={extent}
        layers={layers}
        caption={
          chosen
            ? `${chosen.identity.name ?? chosen.identity.mmsi ?? 'Selected vessel'} · rank ${chosen.rank} of ${all.length}`
            : `${drawn.length} of ${tracks.length} vessel tracks · source region at ${baseScenario ? baseScenario.replace('windage_', '') : 'base'} windage`
        }
      />
      }
    >
      {candidates.analystNotice && (
        <Notice status="warning" title="Read the ranking this way">
          {candidates.analystNotice}
        </Notice>
      )}

      <Caveat of={ais !== 'error' ? ais : undefined} />

      <div className="stage-split">
        <section className="stage-list">
          <div className="stage-list-head">
            <h3>Candidates</h3>
            <Search
              value={query}
              onChange={setQuery}
              placeholder={`Search ${all.length} vessels`}
              label="Search candidates by name, MMSI or flag"
            />
          </div>

          <Table
            caption="Ranked candidate vessels"
            columns={[
              { key: 'rank', header: 'Rank', numeric: true, render: (c: Candidate) => String(c.rank) },
              {
                key: 'vessel',
                header: 'Vessel',
                render: (c: Candidate) => c.identity.name ?? c.identity.mmsi ?? c.candidateId,
              },
              { key: 'type', header: 'Type', render: (c: Candidate) => c.identity.type ?? '—' },
              {
                key: 'score',
                header: 'Score',
                numeric: true,
                render: (c: Candidate) => c.collationScore.toFixed(3),
              },
            ]}
            rows={rows}
            rowKey={(c) => c.candidateId}
            selectedKey={selected}
            onSelect={(c) => setSelected(c.candidateId === selected ? undefined : c.candidateId)}
          />

          {!needle && all.length > rows.length && (
            <p className="stage-note">
              Showing the top {rows.length} of {all.length}. Search to reach the rest.
            </p>
          )}
        </section>

        <div className="stage-inspector">
          {chosen ? (
            <CandidateInspector candidate={chosen} formula={candidates.scoringFormula} />
          ) : (
            <Panel title="No vessel selected" variant="flush">
              <p className="stage-note">
                Choose a candidate to see its identity, the terms its score is made of, and what the ranking could not
                take into account.
              </p>
            </Panel>
          )}
        </div>
      </div>

      {candidates.evaluation && (
        <Panel title="How this ranking was tested" variant="flush">
          <FieldList>
            <Field label="Candidates considered" value={String(candidates.evaluation.candidateCount)} />
            <Field
              label="Documented possible source, ranked"
              value={`${candidates.evaluation.frozenBaselineRank} of ${candidates.evaluation.candidateCount}`}
              note={`Distance alone put it at ${candidates.evaluation.naiveProximityRank}`}
            />
            <Field label="Percentile" value={`${candidates.evaluation.percentile.toFixed(1)}%`} />
          </FieldList>
          <p className="stage-refuses">
            <Badge status="warning">Not a finding</Badge> {candidates.evaluation.note}
          </p>
        </Panel>
      )}

      {candidates.dataQualityWarnings && candidates.dataQualityWarnings.length > 0 && (
        <Notice status="watch" title="What limits this ranking">
          <span className="stage-warnings">
            {candidates.dataQualityWarnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </span>
        </Notice>
      )}
    </StageFrame>
  );
}

/**
 * Why this vessel is where it is in the list.
 *
 * Each term gets its bar, its weight, what it contributed, and the raw
 * quantity underneath — "0 km from the source region", "best match at T−9 h" —
 * because a bar at 100% means nothing without the measurement it came from.
 */
function CandidateInspector({
  candidate,
  formula,
}: {
  candidate: Candidate;
  formula: Candidates['scoringFormula'];
}) {
  const { identity } = candidate;
  return (
    <>
      <Panel
        title={identity.name ?? identity.mmsi ?? candidate.candidateId}
        subtitle={<span className="mono">{identity.mmsi ?? candidate.vesselId}</span>}
        meta={`Rank ${candidate.rank}`}
        variant="flush"
      >
        <FieldList>
          <Field label="MMSI" value={identity.mmsi ?? '—'} identifier />
          <Field label="IMO" value={identity.imo ?? '—'} identifier />
          <Field label="Call sign" value={identity.callsign ?? '—'} identifier />
          <Field label="Type" value={identity.type ?? '—'} numeric={false} />
          <Field label="Gear" value={identity.gearType ?? '—'} numeric={false} />
          <Field label="Flag" value={identity.flag ?? '—'} numeric={false} />
          <Field label="Reports used" value={String(candidate.observationCount)} />
        </FieldList>
      </Panel>

      <Panel title="Why it ranks here" variant="flush" meta={candidate.collationScore.toFixed(3)}>
        {Object.entries(candidate.components).map(([key, component]) => (
          <div key={key} className="stage-term">
            <Meter
              label={`${say(COMPONENT_LABEL, key)} · weight ${component.weight}`}
              value={component.value}
              caption={say(ORIGIN_LABEL, component.origin)}
            />
            <dl className="stage-raw">
              {Object.entries(component.raw).map(([name, value]) => (
                <div key={name}>
                  <dt>{readable(name)}</dt>
                  <dd className="mono">{String(value)}</dd>
                </div>
              ))}
              <div>
                <dt>Contributed</dt>
                <dd className="num">{component.contribution.toFixed(3)}</dd>
              </div>
            </dl>
          </div>
        ))}

        {formula && (
          <div className="stage-formula">
            <p className="mono">{formula.expression}</p>
            <p className="stage-note">{formula.note}</p>
            <p className="stage-note">{formula.vocabulary}</p>
          </div>
        )}
      </Panel>

      {candidate.evidenceLimitations && (
        <Notice status="watch" title="What this evidence cannot settle">
          {candidate.evidenceLimitations}
        </Notice>
      )}
    </>
  );
}
