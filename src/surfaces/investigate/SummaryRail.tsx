/**
 * What the record says about itself, held beside every stage.
 *
 * Two changes from the surface this replaces, and both are the product rather
 * than tidying.
 *
 * **Confidence is not one number.** `0.90` used to sit at the top of the page
 * in the largest type on it. It is the segmenter's confidence that a patch of
 * pixels is darker than its surroundings, and a reader takes it for the
 * confidence of the whole finding — including the vessel. Those are different
 * quantities by orders of magnitude. So the rail gives each dimension its own
 * line, and a dimension with no evidence behind it reads "not assessable"
 * rather than inheriting a neighbour's number.
 *
 * **The raw enums are gone from here.** `AI_DERIVED`, `ISOLINE`, the pixel
 * count and the polygon bounds are still in the product; they live in stage
 * ⑥ Evidence, where someone checking the work will look for them, instead of
 * in the first thing an operator reads.
 */

import { Advanced, Field, FieldList, Meter } from '../../design/components';
import type { SlickFeature } from '../../api/slicks';
import type { Incident, State } from '../../incidents/types';
import { CLASSIFICATION_LABEL, STATE_LABEL, STATE_STATUS, say } from '../../incidents/words';
import { SOURCES, VERIFIER, km, km2, latLon } from '../../format';

/** One dimension of confidence, and what it rests on. */
interface Dimension {
  label: string;
  state: State;
  /** What this dimension is about, so the word "medium" means something. */
  note: string;
}

/**
 * The dimensions, each read from its own evidence.
 *
 * A detection model being sure about a dark region says nothing about whether
 * a named ship caused it, and the rail exists to make that visible.
 */
function dimensions(slick: SlickFeature, incident: Incident | undefined): Dimension[] {
  const p = slick.properties;
  const coverage = (key: string) => incident?.coverage.find((row) => row.key === key)?.state;
  const probability = typeof p.probability === 'number' ? p.probability : undefined;
  const lookalike = p.lookalikeWarning === true;

  const detection: State =
    probability === undefined ? 'UNAVAILABLE' : lookalike ? 'AMBIGUOUS' : probability >= 0.7 ? 'AVAILABLE' : 'PARTIAL';

  return [
    {
      label: 'Detection',
      state: detection,
      note: 'That these pixels are a dark feature. Not that the feature is oil.',
    },
    {
      label: 'Observation quality',
      state: coverage('satellite') ?? (p.geometryKind === 'POLYGON' ? 'AVAILABLE' : 'PARTIAL'),
      note: 'Whether the scene and its geometry were recovered.',
    },
    {
      label: 'Hindcast',
      state: coverage('backtrack') ?? 'UNAVAILABLE',
      note: 'Whether the drift could be run backwards at all.',
    },
    {
      label: 'Source localisation',
      state: coverage('sourceRegion') ?? 'UNAVAILABLE',
      note: 'How tightly the backward run constrains an origin.',
    },
    {
      label: 'Release timing',
      state: 'UNAVAILABLE',
      note: 'No release-window estimator has been run for any record.',
    },
    {
      label: 'Vessel attribution',
      state: incident?.attributionStatus ?? 'UNAVAILABLE',
      note: 'Whether any vessel can be associated with the source region.',
    },
  ];
}

/* Sections of the investigation rail, in the filter rail's own language:
 * plain uppercase headings separated by one hairline, no panel boxes. */
export function SummaryRail({ slick, incident }: { slick: SlickFeature; incident: Incident | undefined }) {
  const p = slick.properties;
  const probability = typeof p.probability === 'number' ? p.probability : undefined;
  const verifier = typeof p.verifier === 'string' ? VERIFIER[p.verifier] : undefined;
  const lookalike = p.lookalikeWarning === true;

  return (
    <>
      <Advanced variant="plain" label="Detection" collapsible={false}>
        {probability !== undefined && (
          <Meter
            label="Detection probability"
            value={probability}
            status={lookalike ? 'warning' : undefined}
            caption="The segmenter's own confidence that these pixels are a dark feature."
          />
        )}
        <FieldList>
          <Field label="Detector" value={SOURCES[String(p.kind)] ?? String(p.source)} numeric={false} />
          <Field
            label="Second opinion"
            value={verifier ?? '—'}
            numeric={false}
            status={lookalike ? 'warning' : undefined}
          />
          <Field
            label="Classification"
            value={say(CLASSIFICATION_LABEL, String(p.classification ?? '')) ?? '—'}
            numeric={false}
          />
        </FieldList>
      </Advanced>

      <Advanced variant="plain" label="Geometry" collapsible={false}>
        <FieldList>
          <Field label="Area" value={km2(p.areaM2)} />
          <Field label="Length" value={km(p.lengthM)} />
          <Field label="Centre" value={latLon(p.centroid)} />
          {typeof p.components === 'number' && p.components > 0 && (
            <Field label="Parts" value={String(p.components)} />
          )}
          {incident?.reported?.areaKm2 !== undefined && (
            <Field
              label="Reported area"
              value={`${incident.reported.areaKm2} km²`}
              note="From the alert record, not measured here"
            />
          )}
        </FieldList>
      </Advanced>

      <Advanced variant="plain" label="Confidence" collapsible={false}>
        {/* One row per dimension. A single headline figure here was the
          * surface's most misleading element. */}
        <ul className="ws-dims">
          {dimensions(slick, incident).map((dimension) => (
            <li key={dimension.label}>
              <span className="ws-dim-label">{dimension.label}</span>
              <span className={`ws-dim-state is-${STATE_STATUS(dimension.state)}`}>
                {dimension.state === 'UNAVAILABLE' ? 'Not assessable' : STATE_LABEL(dimension.state)}
              </span>
              <small>{dimension.note}</small>
            </li>
          ))}
        </ul>

        <Advanced label="Why these differ">
          <p className="ws-note">
            These are separate quantities, not one figure split up. A segmenter that is 90% sure a patch of sea is
            darker than the water around it has said nothing about which ship passed through, and a console that
            reported a single confidence for the whole finding would be claiming it had.
          </p>
        </Advanced>
      </Advanced>
    </>
  );
}
