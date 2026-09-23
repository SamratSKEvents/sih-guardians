/**
 * iap.md — inspection / debugging view. Reads only the IapDocument; every value comes pre-formatted from the plan or
 * through utils/format, so Markdown, JSON and PDF state identical facts.
 */
import type { Assignment, DeltaKind, IapDocument, ReportingRequirement } from '../IapTypes';
import { IAP_CONFIG } from '../IapConfig';
import { KIND_ORDER } from '../analysis/IapDeltaEngine';
import { hhmm, priorityTag, timeRange, utc } from '../utils/format';

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head: string[], rows: string[][]) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- None');

export const DEMO_MARKING = 'DEMONSTRATION / ILLUSTRATIVE DATA — NOT FOR OPERATIONAL USE';
export const VALIDATION_STAMP = { VALID: 'VALIDATED', VALID_WITH_WARNINGS: 'VALIDATED WITH WARNINGS', INVALID: 'DRAFT — NOT VALIDATED' } as const;

export const dueText = (r: ReportingRequirement, ref: string) =>
  r.dueKind === 'BY TIME' ? `By ${hhmm(r.dueAt, ref)} UTC` : r.dueKind === 'INTERVAL' ? `Every ${r.intervalMin} min` : `On event: ${r.event}`;
export const depText = (a: Assignment) => (a.dependencies.length ? a.dependencies.map((d) => (d.type === 'ASSIGNMENT' ? d.ref! : `${d.type}${d.ref ? ` (${d.ref})` : ''}`)).join(', ') : 'None');
export const assignmentTime = (a: Assignment, ref: string) =>
  a.startTime ? `Start ${hhmm(a.startTime, ref)} · on scene ${a.onSceneTime ? hhmm(a.onSceneTime, ref) : 'N/A'} · complete ${hhmm(a.targetCompletion, ref)}${a.commitUntil ? ` · held to ${hhmm(a.commitUntil, ref)}` : ''} UTC` : `NOT SCHEDULED — ${a.status}`;

export function renderMarkdown(doc: IapDocument): string {
  const { header: h, plan: p, validation: v, variant } = doc;
  const full = variant === 'FULL';
  const lim = IAP_CONFIG.limits[variant];
  const ref = h.periodStart;
  const out: string[] = [];
  let n = 0;
  const sec = (title: string, body: string) => out.push(`## ${++n}. ${title}\n\n${body}\n`);

  if (doc.demonstration) out.push(`> **${DEMO_MARKING}**\n`);
  out.push(`# ${h.title} — IAP ${h.iapNo}\n`);
  out.push(`**${variant} IAP** · ${h.status} · **${VALIDATION_STAMP[v.result]}** (${v.result})\n`);
  out.push(table(['Field', 'Value'], [
    ['IAP No / revision', `${h.iapNo} / REV ${h.revision}`], ['Incident', `${h.incidentId} — ${h.incidentName}`], ['Region', h.region],
    ['Operational period', h.operationalPeriod], ['Plan created', utc(h.createdAt)], ['Status', h.status], ['Built against SITREP', h.sitrepRef],
    ['Prepared by', h.preparedBy], ['Reviewed by', h.reviewedBy], ['Approved by', `${h.approvedBy} (${h.approvedAt})`],
    ['Command authority', h.commandAuthority], ['Classification', doc.demonstration ? 'DEMONSTRATION DATA' : h.classification], ['Distribution', h.distribution.join('; ')],
  ]) + '\n');
  out.push(`> ${doc.authorityNotice}\n`);

  const shownIssues = full ? v.issues : v.issues.filter((i) => i.severity !== 'INFO');
  out.push(`### Plan validation: ${v.result}\n\n${shownIssues.length ? table(['Severity', 'Code', 'Message'], shownIssues.map((i) => [i.severity, i.code, i.message])) : 'No validation issues.'}\n`);
  if (p.alerts.length) out.push(`### Alerts\n\n${list(p.alerts.map((a) => `**${a.severity}** — ${a.text}`))}\n`);

  sec('Current situation snapshot', `${table(['Item', 'Value', 'Basis'], p.situation.map((r) => [r.label, r.value, r.basis]))}\n\n**Command emphasis (generated draft):** ${p.commandEmphasis}`);

  if (full) {
    const c = doc.changes;
    sec(c.initial ? 'Changes' : `Changes since IAP ${c.previousIapNo}`, c.initial ? '**INITIAL IAP — NO PREVIOUS PLAN**' : KIND_ORDER.map((k: DeltaKind) => {
      const items = c.deltas.filter((d) => d.kind === k);
      return items.length ? `**${k}**\n\n${list(items.map((d) => d.text))}` : '';
    }).filter(Boolean).join('\n\n'));
  }

  const objs = p.objectives.slice(0, lim.objectives);
  sec('Incident objectives', table(['#', 'ID', 'Priority', 'Objective', 'Reason', 'Success criteria', 'Status'],
    objs.map((o) => [String(o.rank), o.objectiveId, priorityTag(o.priority), o.statement, o.reason, o.successCriteria.join('; '), o.status])) +
    (full ? `\n\n${objs.map((o) => `- **${o.objectiveId}** priority drivers: ${o.priorityDrivers.join('; ')}${o.constraints.length ? ` · constraints: ${o.constraints.join('; ')}` : ''}`).join('\n')}` : '') +
    (p.objectives.length > objs.length ? `\n\n_${p.objectives.length - objs.length} lower-ranked objective(s) in FULL IAP._` : ''));

  if (full) {
    sec('Protection priorities', p.protectionPriorities.length ? table(['Rank', 'Resource', 'Type', 'Sensitivity', 'Exposure', 'Window (MODELLED)', 'Confidence', 'Priority', 'Decide by', 'Assignments', 'Limitations'],
      p.protectionPriorities.map((r) => [String(r.rank), `${r.resourceId} ${r.name}`, r.type, r.sensitivity, r.exposure, r.exposureWindow ? `${utc(r.exposureWindow.start)} – ${utc(r.exposureWindow.end)}` : 'NOT AVAILABLE', r.confidence, r.priority, r.decideBy ? utc(r.decideBy) : 'NOT AVAILABLE', r.assignmentIds.join(', ') || '—', r.limitations.join('; ') || '—'])) +
      `\n\n${p.protectionPriorities.map((r) => `- **${r.resourceId}** drivers: ${r.drivers.join('; ')}`).join('\n')}` : 'Impact assessment NOT AVAILABLE — no protection priorities.');
  }

  const asg = p.assignments.slice(0, lim.assignments);
  sec('Assignment plan', `${table(['ID', 'Objective', 'Priority', 'Task', 'Assigned', 'Time (UTC)', 'Sector', 'Status'],
    asg.map((a) => [a.assignmentId, a.objectiveId, a.priority, a.task, a.assignedUnit, a.startTime ? timeRange(a.startTime, a.targetCompletion, ref) : 'NOT SCHEDULED', a.sectorId ?? '—', `${a.status}${a.statusReason ? ` — ${a.statusReason}` : ''}`]))}` +
    (full ? `\n\n${asg.map((a) => [
      `### ${a.assignmentId} — ${priorityTag(a.priority)} (${a.source})`,
      `- Objective: ${a.objectiveId}`, `- Task: ${a.task}`, `- Assigned: ${a.assignedUnit} (${a.assetIds.join(', ') || 'none'})`, `- Time: ${assignmentTime(a, ref)}`,
      `- Location / sector: ${a.location}`, `- Dependencies: ${depText(a)}`, `- Required information: ${a.requiredInformation.join('; ') || 'None'}`,
      `- Safety notes: ${a.safetyNotes.join('; ') || 'None'}`, `- Success criteria: ${a.successCriteria.join('; ')}`, `- Fallback: ${a.fallbackAction}`,
      `- Assumptions: ${a.assumptionIds.map((x) => `${x} (ASSUMPTION — REQUIRES CONFIRMATION)`).join('; ') || 'None'}`,
      `- Status: ${a.status}${a.statusReason ? ` — ${a.statusReason}` : ''}`,
    ].join('\n')).join('\n\n')}` : ''));

  sec(full ? 'Resource allocation' : 'Resource summary', table(['Asset', 'Type', 'Assignments', 'Availability', 'Status'],
    p.resourceAllocation.map((r) => [`${r.assetId} ${r.name}`, r.kind, r.assignments.map((x) => `${x.assignmentId}${x.from ? ` ${hhmm(x.from, ref)}–${hhmm(x.to, ref)}${x.hold ? ' (hold)' : ''}` : ' (not scheduled)'}`).join('; ') || '—', r.availability, r.status])));

  if (full) {
    sec('Surveillance plan', table(['Task', 'Objective', 'Area', 'Priority', 'Window', 'Platform', 'Reporting', 'Evidence sought', 'Status'],
      p.surveillance.map((x) => [x.taskId, x.objective, x.area, x.priority, x.window ? timeRange(x.window.from, x.window.to, ref) : '—', x.platform, x.reportingRequirement, x.evidenceSought.join('; ') || '—', x.status])));
    sec('Containment / interception preparation', `_PLANNING BASIS — no containment outcome is assured._\n\n${p.containment.length ? table(['Action', 'Sector', 'Planning status', 'Purpose', 'Trigger', 'Assets', 'Readiness', 'Constraints', 'Confidence'],
      p.containment.map((x) => [x.actionId, x.sectorId ?? 'NOT AVAILABLE', x.planningStatus, x.purpose, x.triggerCondition, x.assetIds.join(', ') || '—', x.deploymentReadiness, x.constraints.join('; '), x.confidence])) : 'No containment objective this period.'}`);
    sec('Environmental sampling plan', p.sampling.length ? table(['Sample', 'Location', 'Purpose', 'Priority', 'Sample type', 'Timing', 'Team', 'Chain of custody', 'Required metadata'],
      p.sampling.map((x) => [x.sampleId, x.location, x.purpose, x.priority, x.sampleType, x.timing, x.assignedTeam, x.chainOfCustody, x.requiredMetadata.join(', ')])) : 'No sampling planned this period.');
    sec('Shoreline / cleanup preparation', `Shoreline contact: **${p.shoreline.contact}**. ${p.shoreline.contact === 'CONFIRMED' ? 'ACTIVE RESPONSE tasks apply.' : 'PREPARATION only — no shoreline cleanup is planned.'}\n\n${p.shoreline.tasks.length ? table(['Task', 'Mode', 'Resource', 'Sector', 'Action', 'Assignment', 'Escalation'], p.shoreline.tasks.map((x) => [x.taskId, x.mode, x.resourceId, x.sectorId, x.action, x.assignmentId ?? '—', x.escalationTrigger ?? '—'])) : 'No shoreline tasks.'}`);
  }

  const hz = full ? p.safety.items : p.safety.items.filter((x) => x.severity === 'HIGH').slice(0, lim.hazards);
  sec(full ? 'Safety plan' : 'Critical safety issues', `${p.safety.assessmentAvailable ? '' : '**Site safety assessment: NOT AVAILABLE.** Derived hazards only.\n\n'}${hz.length ? table(['Hazard', 'Type', 'Severity', 'Description', 'Affected assignments', 'Mitigation', 'Stop-work criteria', 'Source'],
    hz.map((x) => [x.hazardId, x.type, x.severity, x.hazard, x.affectedAssignments.join(', ') || '—', x.mitigation, x.stopWorkCriteria, x.source])) : 'No hazards recorded.'}`);

  if (full) {
    sec('Communications plan', `**DEMONSTRATION CHANNEL ASSIGNMENTS** — no real frequencies.\n\n${p.communications.available ? table(['Channel', 'Purpose', 'Participants', 'Primary', 'Backup', 'Reporting interval'], p.communications.rows.map((x) => [x.label, x.purpose, x.participants.join(', ') || '—', x.primary, x.backup, x.reportingInterval])) : 'COMMUNICATIONS PLAN NOT SUPPLIED.'}`);
    sec('Reporting requirements', table(['ID', 'Reporting unit', 'Content', 'Due', 'Recipient', 'Channel'], p.reporting.map((x) => [x.reqId, x.reportingUnit, x.content, dueText(x, ref), x.recipient, x.channelId ?? 'NOT ASSIGNED'])));
  }

  sec('Decision points / triggers', list(p.decisionTriggers.slice(0, lim.triggers).map((t) => `**${t.triggerId}** [${t.status}] — IF ${t.condition} THEN ${t.action}. REQUIRES: ${t.requires.join('; ')}. Authority: ${t.decisionAuthority}${t.decideBy ? `. Decide by ${utc(t.decideBy)}` : ''}. Affects: ${t.affectedAssignments.join(', ') || '—'}`)));

  if (full) {
    sec('Contingency plan', list(p.contingencies.map((c) => `**${c.contingencyId}** [${c.activation}] — ${c.scenario}. Indicator: ${c.indicator}. Actions: ${c.actions.join('; ')}${c.alternateAssets.length ? `. Alternate assets: ${c.alternateAssets.join(', ')}` : ''}${c.activationReason ? `. Reason: ${c.activationReason}` : ''}`)));
  }
  const gaps = full ? p.informationGaps : p.informationGaps.filter((g) => g.priority === 'P1').slice(0, lim.gaps);
  sec(full ? 'Information gaps' : 'Critical information gaps', gaps.length ? table(['Gap', 'Description', 'Operational impact', 'Action to resolve', 'Owner', 'Priority'], gaps.map((g) => [g.gapId, g.description, g.operationalImpact, g.actionToResolve, g.owner, g.priority])) : 'No critical (P1) information gaps.');

  if (full) {
    sec('Assumptions', table(['ID', 'Assumption — REQUIRES CONFIRMATION', 'Basis', 'Used by'], p.assumptions.map((a) => [a.assumptionId, a.statement, a.basis, a.usedBy.join(', ') || '—'])));
    sec('Constraints', table(['ID', 'Type', 'Constraint', 'Affects', 'Source'], p.constraints.map((c) => [c.constraintId, c.type, c.description, c.affectsAssignments.join(', ') || '—', c.source])));
  }
  sec('Approval / sign-off', `${doc.authorityNotice}\n\n${table(['Role', 'Name', 'Date / time'], [['Prepared by', h.preparedBy, utc(h.createdAt)], ['Reviewed by', h.reviewedBy, '—'], ['Approved by', h.approvedBy, h.approvedAt]])}${doc.demonstration ? '\n\nDemonstration plans remain unapproved.' : ''}`);

  if (full) {
    out.push(`## Appendix A — Traceability\n\n${table(['Item', 'Derived from'], [
      ...p.objectives.map((o) => [o.objectiveId, o.derivedFrom.join(', ')]),
      ...p.assignments.map((a) => [a.assignmentId, a.derivedFrom.join(', ')]),
      ...p.decisionTriggers.map((t) => [t.triggerId, t.derivedFrom.join(', ')]),
      ...p.contingencies.map((c) => [c.contingencyId, c.derivedFrom.join(', ')]),
      ...p.alerts.map((a) => [a.alertId, a.derivedFrom.join(', ')]),
      ...p.informationGaps.map((g) => [g.gapId, g.derivedFrom.join(', ')]),
    ])}\n`);
    out.push(`## Appendix B — Plan graph\n\n${p.graph.nodes.length} nodes, ${p.graph.edges.length} edges (objective → assignment → asset / dependency / trigger). Full graph in iap.json \`plan.graph\`.\n`);
  }
  if (doc.demonstration) out.push(`---\n\n_${DEMO_MARKING}_\n`);
  return out.join('\n');
}
