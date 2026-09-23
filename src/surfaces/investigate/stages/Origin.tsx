/**
 * Stage ② — where could it have come from, and when.
 *
 * The answer is a region that grows as you go back, not a pin. Each hindcast
 * hour has a centre and a spread radius, and the spread is the honest part:
 * at T−3 h the ensemble is 8 km across, at T−24 h it is wider still, and
 * drawing all of them together is the clearest statement of uncertainty this
 * console can make. A single marker reading "source" would be a lie the data
 * never told.
 *
 * Windage is a real fork, not a setting. The same observation backtracked at
 * 0%, 1%, 2% and 3% wind drag gives four different origins, and which is right
 * depends on how much of the slick was riding the surface. The run kept all
 * four; so does this, side by side, because picking one for the operator would
 * be hiding the largest single source of error in the reconstruction.
 *
 * **When** is deliberately not a time. There is no release-window estimator in
 * this system, so the stage reports support by hindcast age and says what that
 * is not. "Released at 04:17 UTC" is the kind of sentence this console exists
 * to refuse.
 */

import { useState } from 'react';
import { Badge, Field, FieldList, Notice, Segmented, Table } from '../../../design/components';
import { fetchEnvironment, fetchSourceHypotheses } from '../../../api/incidents';
import { useArtifact } from '../../../incidents/useArtifact';
import type { Environment, SourceHypotheses } from '../../../incidents/types';
import { Caveat, Gap, Unreachable } from '../Gap';
import { CesiumChart } from '../CesiumChart';
import { aroundKm, extentOf, type MapLayer } from '../chart-types';
import { slickLayer } from '../geometry';
import { missingFor, STAGES } from '../stages';
import type { StageProps } from '../Workspace';
import { StageFrame } from '../StageFrame';
import { when } from '../../../format';

const STAGE = STAGES.find((item) => item.id === 'origin')!;

/** How much of the wind the slick was taken to ride, per scenario. */
const scenarioLabel = (scenario: string) => scenario.replace('windage_', '').replace('%', '%');

export function OriginStage({ slick, incident, incidentId }: StageProps) {
  const hypotheses = useArtifact<SourceHypotheses>(incidentId, fetchSourceHypotheses);
  const environment = useArtifact<Environment>(incidentId, fetchEnvironment);
  const [scenario, setScenario] = useState<string>();

  if (!incidentId) {
    return (
      <Gap
        title="No reconstruction exists for this detection"
        needs={[
          { label: 'Slick geometry', has: true },
          { label: 'Acquisition time', has: false },
          { label: 'Historical currents', has: false },
          { label: 'Historical wind', has: false },
        ]}
      >
        {' '}
        Running the drift backwards needs a measured acquisition time and the current and wind fields covering the
        hours before it. This record carries none of them, so there is nothing to run, and a reconstruction would be
        an invention rather than a weak answer.
      </Gap>
    );
  }

  if (hypotheses === 'error') return <Unreachable what="The source-hypothesis artifact" />;
  if (!hypotheses) return <p className="stage-wait">Loading the reconstruction…</p>;

  if (hypotheses.status === 'UNAVAILABLE' || !hypotheses.hypotheses?.length) {
    return (
      <Gap
        title="The drift could not be run backwards"
        of={hypotheses}
        needs={missingFor(STAGE, incident).map((row) => ({ label: row.label, has: false }))}
      />
    );
  }

  const scenarios = hypotheses.scenarios ?? [];
  const current = scenario ?? scenarios[0];
  const shown = hypotheses.hypotheses.filter((h) => !current || h.scenario === current);
  const ages = [...new Set(shown.map((h) => h.ageHours))].sort((a, b) => a - b);

  const layers: MapLayer[] = [
    {
      id: 'support',
      label: 'Source-support regions',
      claim: 'reconstructed',
      shapes: shown.map((h) => ({ kind: 'circle', centre: h.centre, radiusKm: h.spreadRadiusKm, tone: 'source' })),
    },
    {
      id: 'centres',
      label: 'Ensemble centres',
      claim: 'reconstructed',
      shapes: shown.map((h) => ({ kind: 'point', at: h.centre, tone: 'source', radius: 3 })),
    },
    {
      id: 'corridor',
      label: 'Source corridor',
      claim: 'reconstructed',
      shapes: [{ kind: 'path', points: shown.map((h) => h.centre), tone: 'source', width: 1.5 }],
    },
  ];
  if (incident) {
    layers.unshift({
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
      ...shown.flatMap((h) => aroundKm(h.centre, h.spreadRadiusKm)),
      ...(incident ? [incident.centre] : []),
    ],
    incident?.centre ?? { lon: 0, lat: 0 },
    0.2,
  );

  const widest = shown.reduce((a, b) => (b.spreadRadiusKm > a.spreadRadiusKm ? b : a));
  const tightest = shown.reduce((a, b) => (b.spreadRadiusKm < a.spreadRadiusKm ? b : a));

  return (
    <StageFrame
      chart={
      <CesiumChart
        extent={extent}
        layers={layers}
        caption={`Backward ensemble, ${ages.length} horizons to T−${Math.max(...ages)} h · ${scenarioLabel(current ?? '')} windage`}
      />
      }
    >
      <Caveat of={hypotheses.rasterSurface} />

      {scenarios.length > 1 && (
        <div className="stage-controls">
          <span className="stage-control-label">Windage</span>
          <Segmented
            label="How much of the wind the slick was taken to ride"
            value={current ?? scenarios[0]}
            onChange={setScenario}
            options={scenarios.map((value) => ({ value, label: scenarioLabel(value) }))}
          />
          <p className="stage-control-note">
            The fraction of wind speed added to the current. Each choice is a different reconstruction, not a
            different rendering of one.
          </p>
        </div>
      )}

      <div className="stage-cols">
        <section>
          <h3>How far back the answer holds</h3>
          <Table
            caption="Source-support region per hindcast horizon"
            columns={[
              { key: 'age', header: 'Horizon', numeric: true, render: (h) => `T−${h.ageHours} h` },
              { key: 'time', header: 'Time (UTC)', render: (h) => when.format(Date.parse(h.time)) },
              {
                key: 'spread',
                header: 'Spread',
                numeric: true,
                render: (h) => `${h.spreadRadiusKm.toFixed(1)} km`,
              },
              { key: 'n', header: 'Particles', numeric: true, render: (h) => String(h.particleCount) },
            ]}
            rows={shown}
            rowKey={(h) => `${h.scenario}-${h.ageHours}`}
          />
          <p className="stage-refuses">
            <Badge claim="reconstructed" /> A region the slick is consistent with having drifted from. Not a release
            point, and not a calibrated probability — the ensemble was never calibrated against known releases.
          </p>
        </section>

        <section>
          <h3>When could it have been released?</h3>
          <Notice status="inactive" title="No release time is estimated">
            This system has no release-window estimator. What the reconstruction supports is a range of ages: the
            observation is consistent with a release anywhere between T−{Math.min(...ages)} h and T−
            {Math.max(...ages)} h, and the run gives no basis for preferring a moment inside it.
          </Notice>
          <FieldList>
            <Field label="Earliest supported" value={`T−${Math.max(...ages)} h`} />
            <Field label="Latest supported" value={`T−${Math.min(...ages)} h`} />
            <Field
              label="Tightest constraint"
              value={`${tightest.spreadRadiusKm.toFixed(1)} km at T−${tightest.ageHours} h`}
              note="Where the ensemble is narrowest, not where release is most likely"
            />
            <Field
              label="Widest"
              value={`${widest.spreadRadiusKm.toFixed(1)} km at T−${widest.ageHours} h`}
              note="Uncertainty grows with every hour run backwards"
            />
          </FieldList>
        </section>
      </div>

      <TransportInspector environment={environment} />

      {hypotheses.warnings && hypotheses.warnings.length > 0 && (
        <Notice status="watch" title="What this run was and was not">
          <span className="stage-warnings">
            {hypotheses.warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </span>
        </Notice>
      )}
    </StageFrame>
  );
}

/**
 * The forcing that moved the particles.
 *
 * A reconstruction is only as good as the fields under it, so the datasets,
 * their resolution and how much of the grid is empty are shown beside the
 * answer rather than filed under provenance. The currents here are 48% void
 * over land and product gaps, and that is the single most important number on
 * this stage.
 */
function TransportInspector({ environment }: { environment: ReturnType<typeof useArtifact<Environment>> }) {
  if (environment === 'error') return <Unreachable what="The environmental artifact" />;
  if (!environment) return null;
  if (environment.status === 'UNAVAILABLE') {
    return <Gap title="No environmental forcing was recovered" of={environment} />;
  }

  const fields = [
    { key: 'wind', label: 'Wind', summary: environment.wind },
    { key: 'currents', label: 'Currents', summary: environment.currents },
  ].filter((field) => field.summary);

  return (
    <section className="stage-transport">
      <h3>What moved it</h3>
      <div className="stage-cols">
        {fields.map(({ key, label, summary }) => (
          <div key={key}>
            <h4>{label}</h4>
            <FieldList>
              <Field label="Dataset" value={summary!.dataset} identifier />
              <Field label="Provider" value={summary!.provider} numeric={false} />
              <Field label="Variable" value={summary!.variable} numeric={false} />
              <Field label="Grid" value={`${summary!.gridShape[0]} × ${summary!.gridShape[1]}`} />
              <Field
                label="Speed range"
                value={`${summary!.speedRange[0].toFixed(2)}–${summary!.speedRange[1].toFixed(2)} ${summary!.units}`}
              />
              <Field
                label="Empty cells"
                value={`${summary!.missingPercent.toFixed(1)}%`}
                status={summary!.missingPercent > 10 ? 'warning' : undefined}
                note={summary!.coverageNote ? undefined : 'Cells with no value are voids, never zero flow'}
              />
              <Field label="Frames" value={String(summary!.times.length)} note="Hourly" />
            </FieldList>
            {summary!.coverageNote && <p className="stage-note">{summary!.coverageNote}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
