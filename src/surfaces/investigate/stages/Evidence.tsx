/**
 * Stage ⑥ — how do we know any of this.
 *
 * Everything the old surface put in front of an operator on first open lives
 * here: the classification enum, where the outline came from, the pixel count,
 * the polygon bounds, the model identifiers. None of it was deleted — it is
 * the answer to a real question, just not to the first one. Someone checking
 * the work comes looking for it; someone deciding whether to send a boat does
 * not.
 *
 * What the bundle adds is the part that makes it a chain rather than a list:
 * every input carries its SHA-256 and its byte count, the pipeline is recorded
 * stage by stage with the producer of each, and the whole run is frozen at a
 * timestamp. The point is not that anyone will check the hashes. It is that
 * the run cannot be quietly re-done and still called the same result.
 */

import { Advanced, Badge, Field, FieldList, Notice, Panel, Table } from '../../../design/components';
import { fetchPosthoc, fetchProvenance } from '../../../api/incidents';
import { useArtifact } from '../../../incidents/useArtifact';
import type { Posthoc, Provenance, ProvenanceSource } from '../../../incidents/types';
import {
  CLASSIFICATION_LABEL,
  GEOMETRY_SOURCE,
  QUESTION_LABEL,
  STATE_LABEL,
  STATE_STATUS,
  say,
} from '../../../incidents/words';
import { Unreachable } from '../Gap';
import type { StageProps } from '../Workspace';
import { SlickChart, StageFrame } from '../StageFrame';
import { when } from '../../../format';

/** Just the file name: the frozen paths are absolute on someone else's disk. */
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** `embedded`: rendered under Detection, which owns the chart. */
export function EvidenceStage({ slick, incident, incidentId, embedded = false }: StageProps & { embedded?: boolean }) {
  const provenance = useArtifact<Provenance>(incidentId, fetchProvenance);
  const posthoc = useArtifact<Posthoc>(incidentId, fetchPosthoc);
  const p = slick.properties;
  const bbox = Array.isArray(p.bbox) ? (p.bbox as number[]) : undefined;

  if (provenance === 'error') return <Unreachable what="The provenance record" />;

  const statements = provenance?.capabilityStatements;

  return (
    <StageFrame chart={embedded ? undefined : <SlickChart slick={slick} />}>
      {statements && (
        <Panel title="What this investigation supports, question by question" variant="flush">
          <ul className="ev-questions">
            {Object.entries(statements).map(([key, statement]) => (
              <li key={key}>
                <span className="ev-question">{say(QUESTION_LABEL, key)}</span>
                <Badge status={STATE_STATUS(statement.status)}>{STATE_LABEL(statement.status)}</Badge>
                <small>{statement.detail}</small>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="This record" variant="flush">
        <FieldList>
          <Field label="Identifier" value={slick.id} identifier />
          <Field label="Detector" value={String(p.source)} identifier />
          <Field
            label="Classification"
            value={say(CLASSIFICATION_LABEL, String(p.classification ?? '')) ?? '—'}
            numeric={false}
            note={typeof p.classification === 'string' ? p.classification : undefined}
          />
          <Field
            label="Outline from"
            value={say(GEOMETRY_SOURCE, String(p.gsrc ?? '')) ?? '—'}
            numeric={false}
            note={typeof p.gsrc === 'string' ? p.gsrc : undefined}
          />
          <Field label="Scene" value={String(p.scene ?? '—')} identifier />
          {typeof p.pixels === 'number' && <Field label="Pixels" value={p.pixels.toLocaleString('en-GB')} />}
          {typeof p.probabilityP95 === 'number' && (
            <Field label="Probability p95" value={p.probabilityP95.toFixed(4)} />
          )}
          <Field
            label="Second opinion"
            value={typeof p.verifier === 'string' ? p.verifier : '—'}
            identifier
            note="The raw verdict code, as the record stores it"
          />
          {typeof p.mergedSources === 'number' && (
            <Field label="Merged from" value={`${p.mergedSources} source${p.mergedSources === 1 ? '' : 's'}`} />
          )}
          {typeof p.duplicateOf === 'string' && <Field label="Duplicate of" value={p.duplicateOf} identifier />}
          {bbox && (
            <Field
              label="Bounds"
              value={
                <>
                  <span className="ev-pair">{`${bbox[1].toFixed(4)}…${bbox[3].toFixed(4)}° N`}</span>{' '}
                  <span className="ev-pair">{`${bbox[0].toFixed(4)}…${bbox[2].toFixed(4)}° E`}</span>
                </>
              }
            />
          )}
        </FieldList>
      </Panel>

      {incident && (
        <Panel title="Data coverage" variant="flush" meta={`${incident.coverage.filter((row) => row.state !== 'UNAVAILABLE').length}/${incident.coverage.length}`}>
          <ul className="ev-coverage">
            {incident.coverage.map((row) => (
              <li key={row.key}>
                <span className="ev-coverage-label">{row.label}</span>
                <Badge status={STATE_STATUS(row.state)}>{STATE_LABEL(row.state)}</Badge>
                {row.detail && <small>{row.detail}</small>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {provenance && provenance.status !== 'UNAVAILABLE' && (
        <>
          <Panel
            title="How this result was produced"
            variant="flush"
            meta={provenance.release}
            subtitle={provenance.frozenAt ? `Frozen ${when.format(Date.parse(provenance.frozenAt))} UTC` : undefined}
          >
            <ol className="ev-pipeline">
              {(provenance.pipeline ?? []).map((step) => (
                <li key={step.stage}>
                  <span className="ev-stage">{step.stage}</span>
                  <span className="ev-producer">{step.producer}</span>
                  <span className="ev-output">{step.output}</span>
                  {step.note && <small>{step.note}</small>}
                </li>
              ))}
            </ol>
            {provenance.isSyntheticDemo === false && (
              <p className="stage-refuses">
                <Badge status="clear">Real inputs</Badge> This run used recovered historical data, not generated
                stand-ins. The record says so itself, which is the only reason this console repeats it.
              </p>
            )}
          </Panel>

          <Panel title="Inputs" variant="flush" meta={`${(provenance.sources ?? []).length} files`}>
            <Advanced label="Every input, with its hash" count={(provenance.sources ?? []).length}>
              <Table
                caption="Input files and their SHA-256 hashes"
                columns={[
                  { key: 'role', header: 'Role', render: (s: ProvenanceSource) => s.role },
                  { key: 'file', header: 'File', render: (s: ProvenanceSource) => fileName(s.path) },
                  {
                    key: 'bytes',
                    header: 'Size',
                    numeric: true,
                    render: (s: ProvenanceSource) => `${(s.bytes / 1e6).toFixed(2)} MB`,
                  },
                  {
                    key: 'hash',
                    header: 'SHA-256',
                    render: (s: ProvenanceSource) => <span className="mono">{s.sha256.slice(0, 12)}…</span>,
                  },
                ]}
                rows={provenance.sources ?? []}
                rowKey={(s) => `${s.role}-${s.sha256}`}
              />
            </Advanced>
          </Panel>
        </>
      )}

      {posthoc && posthoc !== 'error' && posthoc.status !== 'UNAVAILABLE' && posthoc.analyses && (
        <Panel title="What else was tried" variant="flush" subtitle={posthoc.headline}>
          <Table
            caption="Post-hoc ranking variants and their verdicts"
            columns={[
              { key: 'name', header: 'Variant', render: (a) => a.name },
              {
                key: 'verdict',
                header: 'Verdict',
                render: (a) => <Badge status={STATE_STATUS(a.status)}>{a.verdict.replace(/_/g, ' ').toLowerCase()}</Badge>,
              },
              { key: 'detail', header: 'Result', render: (a) => a.verdictDetail },
            ]}
            rows={posthoc.analyses}
            rowKey={(a) => a.id}
          />
          {posthoc.guardrail && (
            <Notice status="watch" title="These are exploratory">
              {posthoc.guardrail}
            </Notice>
          )}
        </Panel>
      )}

      <Panel title="Human actions" variant="flush">
        <p className="stage-note">
          Nothing on this record has been edited, reviewed or overridden by a person. When the console gains polygon
          editing, candidate review and report approval, each will be recorded here with who did it and when — an
          unedited record and an unrecorded edit must never look the same.
        </p>
      </Panel>
    </StageFrame>
  );
}
