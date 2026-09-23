/**
 * iap.pdf — the operational document, in the same GUARDIANS visual family as the technical report and the SITREP
 * (technical frame, title block, engineering tables, drafting stamps). Renders an IapDocument only; depends on font
 * bytes, not files. QUICK ≈ 2–3 sheets, FULL ≈ 6–10 sheets.
 */
import PDFDocument from 'pdfkit';
import { toBytes } from 'pdfkit/output';
import type { Assignment, DeltaKind, IapDocument, Priority } from '../IapTypes';
import { IAP_CONFIG } from '../IapConfig';
import { KIND_ORDER } from '../analysis/IapDeltaEngine';
import { hhmm, priorityTag, utc } from '../utils/format';
import { DEMO_MARKING, VALIDATION_STAMP, depText, dueText } from './MarkdownRenderer';
import {
  C, DASH, Flow, LW, PAGE, ReportContext, T,
  drawCell, drawEngineeringTable, drawLogo, drawStatusStamp, drawTechnicalFrame,
  type FontBytes, type TechnicalIncidentReport,
} from './pdf/reportDesign';
import { dependencyHeight, drawDependencyDiagram, drawSectorOverview, drawTimeline, timelineHeight } from './pdf/IapVisuals';

class IapPdfContext extends ReportContext {
  readonly iap: IapDocument;
  constructor(doc: PDFKit.PDFDocument, iap: IapDocument, fonts: FontBytes) {
    super(doc, { metadata: { isDemonstrationData: iap.demonstration } } as unknown as TechnicalIncidentReport, fonts);
    this.iap = iap;
  }
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** Trim a single-line string to the available width (PDFKit ellipsis needs wrapping, which we do not want here). */
function fit(ctx: ReportContext, text: string, w: number, cs = 0) {
  let t = text;
  while (t.length > 4 && ctx.width(t, cs) > w) t = `${t.slice(0, -2).trimEnd()}…`;
  return t;
}
const PRI_TONE: Record<Priority, { fill: boolean; dash: number[] | null }> = { P1: { fill: true, dash: null }, P2: { fill: false, dash: null }, P3: { fill: false, dash: DASH.dotted } };

export async function renderPdf(iap: IapDocument, fonts: FontBytes): Promise<Uint8Array> {
  const h = iap.header;
  const doc = new PDFDocument({
    size: 'A4', margin: 0, autoFirstPage: false, bufferPages: true, font: fonts.sans as any, pdfVersion: '1.7', lang: 'en-IN', displayTitle: true,
    info: {
      Title: `IAP ${h.iapNo} (${iap.variant}) — ${h.incidentId}`,
      Author: h.preparedBy,
      Subject: `${h.title}. Operational period ${h.operationalPeriod}.${iap.demonstration ? ` ${DEMO_MARKING}.` : ''}`,
      Keywords: `IAP, ${h.incidentId}, ${h.status}, ${iap.validation.result}`,
      Creator: h.modelVersion,
      Producer: 'PDFKit',
      CreationDate: new Date(h.createdAt),
    },
  } as any);
  const output = toBytes(doc);
  const ctx = new IapPdfContext(doc, iap, fonts);
  const f = new Flow(ctx, { orientation: 'portrait', kind: 'standard', sectionNo: 'IAP', sectionTitle: `${iap.variant} IAP ${h.iapNo}` });
  body(ctx, f);
  finalize(ctx);
  doc.end();
  return output;
}

/* ================================================================== body */

function body(ctx: IapPdfContext, f: Flow) {
  const iap = ctx.iap, p = iap.plan, h = iap.header;
  const full = iap.variant === 'FULL';
  const lim = IAP_CONFIG.limits[iap.variant];
  const ref = h.periodStart;
  let no = 0;
  const H = (title: string, keep = 60, note?: string) => heading(f, ++no, title, keep, note, full ? 7 : 4);

  titleBlock(ctx, f, !full);
  alertsBlock(ctx, f, full);

  H('Current situation snapshot', 90, 'FACTS REQUIRED FOR THIS PLAN ONLY');
  if (full) {
    drawEngineeringTable(f, {
      rows: p.situation, rowPad: 1.6,
      columns: [
        { header: 'Item', w: 1, font: 'condMedium', value: (r) => r.label },
        { header: 'Value', w: 3.2, value: (r) => r.value },
        { header: 'Basis', w: 0.8, font: 'condSemi', align: 'center', value: (r) => r.basis },
      ],
    });
  } else twoColumnFacts(ctx, f, p.situation.map((r) => [r.label, r.value] as [string, string]));
  f.gap(2);
  emphasis(ctx, f, p.commandEmphasis);

  if (full && p.sectors.length) {
    const room = f.bottom - f.y - 20;
    f.figure(room >= 112 ? Math.min(150, room) : 150, 'Planning sectors, priority resources and tasked assignments', (b) => drawSectorOverview(ctx, b, p), { note: 'SCHEMATIC — DEMONSTRATION GEOMETRY, NOT TO SCALE' });
  }

  if (full) {
    H(iap.changes.initial ? 'Changes' : `Changes since IAP ${iap.changes.previousIapNo}`, 50, 'DETERMINISTIC COMPARISON');
    changesBlock(ctx, f);
  }

  H('Incident objectives', 110, 'RANKED — EVERY OBJECTIVE TRACEABLE TO INPUT DATA');
  const objs = p.objectives.slice(0, lim.objectives);
  drawEngineeringTable(f, {
    rows: objs, rowPad: 2.4, highlight: (o) => o.priority === 'P1',
    columns: [
      { header: '#', w: 0.3, font: 'monoMedium', align: 'center', value: (o) => p2(o.rank) },
      { header: 'Priority', w: 0.85, drawH: 9, draw: (c, o, b) => priorityTagBox(c, o.priority, b.x + 3, b.y + b.h / 2, b.w - 6) },
      { header: 'Objective', w: 2.5, font: 'sansMedium', value: (o) => o.statement },
      { header: 'Why', w: 1.7, value: (o) => o.reason },
      { header: 'Success criteria', w: 1.9, value: (o) => o.successCriteria.join(' · ') },
      { header: 'Status', w: 0.95, font: 'condSemi', value: (o) => o.status },
    ],
  });
  if (full) f.para(`Priority drivers — ${objs.map((o) => `${o.objectiveId}: ${o.priorityDrivers.join('; ')}${o.constraints.length ? ` (constraints: ${o.constraints.join('; ')})` : ''}`).join('  ·  ')}`, { size: T.label, color: C.ink3, lineGap: 1 });
  if (p.objectives.length > objs.length) f.para(`${p.objectives.length - objs.length} lower-ranked objective(s) are listed in the FULL IAP.`, { size: T.label, color: C.ink3 });

  if (full) {
    H('Protection priorities', 90, 'POTENTIAL EXPOSURE — MODELLED, NOT OBSERVED');
    if (!p.protectionPriorities.length) f.para('Impact assessment NOT AVAILABLE — protection priorities cannot be derived.', { size: T.body });
    else {
      drawEngineeringTable(f, {
        rows: p.protectionPriorities, rowPad: 2.4, highlight: (r) => r.priority === 'P1',
        columns: [
          { header: 'Rank', w: 0.3, font: 'monoMedium', align: 'center', value: (r) => String(r.rank) },
          { header: 'Priority', w: 0.55, font: 'condBold', align: 'center', value: (r) => r.priority },
          { header: 'Resource', w: 1.6, font: 'condMedium', value: (r) => `${r.resourceId} ${r.name}` },
          { header: 'Type / sensitivity', w: 1.15, value: (r) => `${r.type}\n${r.sensitivity}` },
          { header: 'Exposure', w: 0.6, font: 'condSemi', value: (r) => r.exposure },
          { header: 'Est. window', unit: 'UTC', w: 1.15, font: 'mono', value: (r) => (r.exposureWindow ? `${hhmm(r.exposureWindow.start, ref)}–${hhmm(r.exposureWindow.end, ref)}` : 'NOT AVAILABLE') },
          { header: 'Decide by', unit: 'UTC', w: 0.62, font: 'monoMedium', value: (r) => (r.decideBy ? hhmm(r.decideBy, ref) : 'N/A') },
          { header: 'Assignments', w: 0.95, font: 'mono', value: (r) => r.assignmentIds.join(' ') || '—' },
          { header: 'Limitations', w: 1.4, value: (r) => r.limitations.join('; ') || '—' },
        ],
      });
      f.para(`Priority basis — ${p.protectionPriorities.map((r) => `${r.resourceId}: ${r.drivers.join('; ')}`).join('  ·  ')}`, { size: T.label, color: C.ink3, lineGap: 1 });
    }
  }

  H('Assignment plan', 120, 'REQUIRES COMMAND AUTHORIZATION');
  const asg = p.assignments.slice(0, lim.assignments);
  if (full) asg.forEach((a) => assignmentBlock(ctx, f, a, ref));
  else {
    drawEngineeringTable(f, {
      rows: asg, rowPad: 2.2, highlight: (a) => a.priority === 'P1',
      columns: [
        { header: 'ID', w: 0.8, font: 'monoMedium', value: (a) => a.assignmentId },
        { header: 'Pri', w: 0.3, font: 'condBold', align: 'center', value: (a) => a.priority },
        { header: 'Task', w: 3.4, value: (a) => a.task },
        { header: 'Assigned', w: 1.3, font: 'cond', value: (a) => a.assetIds.join(', ') || 'NOT ASSIGNED' },
        { header: 'Time', unit: 'UTC', w: 0.95, font: 'mono', value: (a) => (a.startTime ? `${hhmm(a.startTime, ref)}–${hhmm(a.targetCompletion, ref)}` : '—') },
        { header: 'Status', w: 1.0, font: 'condSemi', value: (a) => a.status },
      ],
    });
  }

  H(full ? 'Resource allocation' : 'Resource summary', 100, full ? undefined : 'TASKED AND UNAVAILABLE ASSETS');
  drawEngineeringTable(f, {
    rows: full ? p.resourceAllocation : p.resourceAllocation.filter((r) => r.status !== 'UNTASKED'), rowPad: 2, highlight: (r) => r.status === 'UNAVAILABLE',
    columns: [
      { header: 'Asset', w: 0.62, font: 'monoMedium', value: (r) => r.assetId },
      { header: 'Type', w: 1.0, font: 'cond', value: (r) => r.kind },
      { header: 'Assigned task(s)', w: 1.75, font: 'mono', value: (r) => r.assignments.map((x) => `${x.assignmentId}${x.from ? ` ${hhmm(x.from, ref)}–${hhmm(x.to, ref)}${x.hold ? 'H' : ''}` : ''}`).join('  ') || '—' },
      { header: 'Sector', w: 0.55, font: 'mono', value: (r) => [...new Set(r.assignments.map((x) => x.sectorId).filter(Boolean))].join(' ') || '—' },
      { header: 'Availability', w: 1.5, value: (r) => r.availability },
      { header: 'Status', w: 0.85, font: 'condSemi', value: (r) => r.status },
      ...(full ? [{ header: 'Limitations', w: 1.4, value: (r: typeof p.resourceAllocation[number]) => r.limitations.join('; ') || '—' }] : []),
    ],
  });
  if (full && p.resourceAllocation.some((r) => r.assignments.some((x) => x.from))) {
    const hgt = timelineHeight(iap);
    f.figure(hgt, `Operational period ${h.operationalPeriod} — exposure windows, decision times and asset tasking`, (b) => drawTimeline(ctx, b, iap), { note: 'H = HELD IN READINESS' });
  }

  if (full) {
    H('Surveillance plan', 80);
    drawEngineeringTable(f, {
      rows: p.surveillance, rowPad: 2.2,
      columns: [
        { header: 'Task', w: 0.85, font: 'monoMedium', value: (x) => x.taskId },
        { header: 'Pri', w: 0.34, font: 'condBold', align: 'center', value: (x) => x.priority },
        { header: 'Objective', w: 2.1, value: (x) => x.objective },
        { header: 'Area / sector', w: 1.3, font: 'cond', value: (x) => x.area },
        { header: 'Window', unit: 'UTC', w: 0.8, font: 'mono', value: (x) => (x.window ? `${hhmm(x.window.from, ref)}–${hhmm(x.window.to, ref)}` : '—') },
        { header: 'Platform', w: 1.2, font: 'cond', value: (x) => x.platform },
        { header: 'Evidence sought / reporting', w: 2.1, value: (x) => [x.evidenceSought.join('; '), x.reportingRequirement].filter((s) => s && s !== '—').join('. ') },
        { header: 'Status', w: 1.5, font: 'condSemi', value: (x) => (x.status.length > 150 ? `${x.status.slice(0, 149)}…` : x.status) },
      ],
    });

    H('Containment / interception preparation', 70, 'PLANNING BASIS — NO CONTAINMENT OUTCOME IS ASSURED');
    if (!p.containment.length) f.para('No containment objective this period.', { size: T.body });
    else {
      drawEngineeringTable(f, {
        rows: p.containment, rowPad: 2.4,
        columns: [
          { header: 'Action', w: 0.45, font: 'monoMedium', value: (x) => x.actionId },
          { header: 'Sector', w: 0.5, font: 'mono', value: (x) => x.sectorId ?? 'N/A' },
          { header: 'Planning status', w: 1.5, font: 'condSemi', value: (x) => x.planningStatus },
          { header: 'Purpose', w: 2.0, value: (x) => x.purpose },
          { header: 'Trigger condition', w: 2.0, value: (x) => x.triggerCondition },
          { header: 'Assets / readiness', w: 1.7, value: (x) => `${x.assetIds.join(', ') || '—'}. ${x.deploymentReadiness}` },
          { header: 'Confidence', w: 0.6, font: 'condSemi', align: 'center', value: (x) => x.confidence },
        ],
      });
      f.para(`Constraints: ${p.containment.flatMap((x) => x.constraints).join(' · ')}`, { size: T.label, color: C.ink3 });
    }

    H('Environmental sampling plan', 70, 'CHAIN OF CUSTODY REQUIRED');
    if (!p.sampling.length) f.para('No sampling planned this period.', { size: T.body });
    else drawEngineeringTable(f, {
      rows: p.sampling, rowPad: 2.2,
      columns: [
        { header: 'Sample', w: 0.46, font: 'monoMedium', value: (x) => x.sampleId },
        { header: 'Pri', w: 0.34, font: 'condBold', align: 'center', value: (x) => x.priority },
        { header: 'Location', w: 1.7, font: 'condMedium', value: (x) => x.location },
        { header: 'Purpose', w: 1.9, value: (x) => x.purpose },
        { header: 'Sample type', w: 1.5, value: (x) => x.sampleType },
        { header: 'Timing', w: 0.8, font: 'mono', value: (x) => x.timing },
        { header: 'Team', w: 1.0, font: 'cond', value: (x) => x.assignedTeam },
        { header: 'Custody', w: 1.5, value: (x) => x.chainOfCustody },
      ],
    });
    if (p.sampling.length) f.para(`Required metadata for every sample: ${p.sampling[0].requiredMetadata.join(', ')}.`, { size: T.label, color: C.ink3 });

    H('Shoreline preparation', 50, p.shoreline.contact === 'CONFIRMED' ? 'ACTIVE RESPONSE' : 'PREPARATION ONLY');
    f.para(`Shoreline contact: ${p.shoreline.contact}. ${p.shoreline.contact === 'CONFIRMED' ? 'Shoreline assessment and authorised response tasks apply.' : 'No shoreline cleanup is planned: tasks are limited to pre-impact assessment and preparation.'}`, { size: T.body, font: 'sansMedium' });
    if (p.shoreline.tasks.length) drawEngineeringTable(f, {
      rows: p.shoreline.tasks, rowPad: 2.2,
      columns: [
        { header: 'Task', w: 0.5, font: 'monoMedium', value: (x) => x.taskId },
        { header: 'Mode', w: 0.8, font: 'condSemi', value: (x) => x.mode },
        { header: 'Resource / sector', w: 1.0, font: 'mono', value: (x) => `${x.resourceId} / ${x.sectorId}` },
        { header: 'Action', w: 3.6, value: (x) => x.action },
        { header: 'Assignment', w: 0.8, font: 'mono', value: (x) => x.assignmentId ?? '—' },
        { header: 'Escalation', w: 0.7, font: 'mono', value: (x) => x.escalationTrigger ?? '—' },
      ],
    });
  }

  const hz = full ? p.safety.items : p.safety.items.filter((x) => x.severity === 'HIGH').slice(0, lim.hazards);
  H(full ? 'Safety plan' : 'Critical safety issues', 80, p.safety.assessmentAvailable ? 'SITE SAFETY PLAN INPUT + DERIVED' : 'SITE SAFETY ASSESSMENT NOT AVAILABLE');
  if (!hz.length) f.para('No hazards recorded for the planned activities.', { size: T.body });
  else drawEngineeringTable(f, {
    rows: hz, rowPad: 2.2, highlight: (x) => x.severity === 'HIGH',
    columns: [
      { header: 'ID', w: 0.72, font: 'monoMedium', value: (x) => x.hazardId },
      { header: 'Hazard', w: 2.0, value: (x) => `${x.type} — ${x.hazard}` },
      { header: 'Sev', w: 0.35, font: 'condBold', align: 'center', value: (x) => x.severity[0] },
      { header: 'Affects', w: 1.3, font: 'mono', value: (x) => x.affectedAssignments.join(' ') || '—' },
      { header: 'Mitigation', w: 2.4, value: (x) => x.mitigation },
      { header: 'Stop-work criteria', w: 2.0, value: (x) => x.stopWorkCriteria },
    ],
  });

  if (full) {
    H('Communications plan', 60, 'DEMONSTRATION CHANNEL ASSIGNMENTS — NO REAL FREQUENCIES');
    if (!p.communications.available) f.para('COMMUNICATIONS PLAN NOT SUPPLIED. Channel assignments and reporting routes are undefined.', { size: T.body, font: 'sansMedium' });
    else drawEngineeringTable(f, {
      rows: p.communications.rows, rowPad: 2.2,
      columns: [
        { header: 'Channel', w: 1.2, font: 'condSemi', value: (x) => x.label },
        { header: 'Purpose', w: 1.9, value: (x) => x.purpose },
        { header: 'Participants', w: 1.5, font: 'mono', value: (x) => x.participants.join(' ') || '—' },
        { header: 'Primary', w: 1.6, value: (x) => x.primary },
        { header: 'Backup', w: 1.4, value: (x) => x.backup },
        { header: 'Reporting interval', w: 1.1, font: 'cond', value: (x) => x.reportingInterval },
      ],
    });

    H('Reporting requirements', 70);
    drawEngineeringTable(f, {
      rows: p.reporting, rowPad: 2,
      columns: [
        { header: 'ID', w: 0.85, font: 'mono', value: (x) => x.reqId },
        { header: 'Reporting unit', w: 1.5, font: 'cond', value: (x) => x.reportingUnit },
        { header: 'Content', w: 3.1, value: (x) => x.content },
        { header: 'Due', w: 1.2, font: 'condMedium', value: (x) => dueText(x, ref) },
        { header: 'To', w: 1.2, font: 'cond', value: (x) => x.recipient },
        { header: 'Channel', w: 0.7, font: 'mono', value: (x) => x.channelId ?? 'N/A' },
      ],
    });
  }

  H('Decision points / triggers', 90, 'COMMAND DECISIONS — NOT AUTOMATIC ACTIONS');
  p.decisionTriggers.slice(0, lim.triggers).forEach((t) => triggerBlock(ctx, f, t, full));

  if (full) {
    H('Contingencies', 80);
    drawEngineeringTable(f, {
      rows: p.contingencies, rowPad: 2.2, highlight: (c) => c.activation === 'ACTIVATED',
      columns: [
        { header: 'ID', w: 0.85, font: 'monoMedium', value: (c) => c.contingencyId },
        { header: 'State', w: 0.7, font: 'condBold', value: (c) => c.activation },
        { header: 'Scenario / indicator', w: 2.1, value: (c) => `${c.scenario}. Indicator: ${c.indicator}.` },
        { header: 'Actions', w: 3.3, value: (c) => c.actions.map((a, i) => `${i + 1}. ${a}`).join(' ') },
        { header: 'Alternate assets', w: 1.0, font: 'mono', value: (c) => c.alternateAssets.join(' ') || '—' },
      ],
    });
  }

  const gaps = full ? p.informationGaps : p.informationGaps.filter((g) => g.priority === 'P1').slice(0, lim.gaps);
  H(full ? 'Information gaps' : 'Critical information gaps', 60, 'WHAT IS NOT KNOWN');
  if (!gaps.length) f.para('No critical (P1) information gaps.', { size: T.body });
  else drawEngineeringTable(f, {
    rows: gaps, rowPad: 2,
    columns: [
      { header: 'Gap', w: 0.8, font: 'monoMedium', value: (g) => g.gapId },
      { header: 'Pri', w: 0.34, font: 'condBold', align: 'center', value: (g) => g.priority },
      { header: 'Description', w: 2.1, value: (g) => g.description },
      { header: 'Operational impact', w: 2.4, value: (g) => g.operationalImpact },
      { header: 'Action to resolve', w: 2.3, value: (g) => g.actionToResolve },
      { header: 'Owner', w: 1.1, font: 'cond', value: (g) => g.owner },
    ],
  });

  if (full) {
    H('Assumptions', 60, 'ASSUMPTION — REQUIRES CONFIRMATION');
    drawEngineeringTable(f, {
      rows: p.assumptions, rowPad: 2,
      columns: [
        { header: 'ID', w: 0.9, font: 'monoMedium', value: (a) => a.assumptionId },
        { header: 'Assumption', w: 3.6, value: (a) => a.statement },
        { header: 'Basis', w: 1.8, value: (a) => a.basis },
        { header: 'Used by', w: 1.6, font: 'mono', value: (a) => a.usedBy.join(' ') || '—' },
        { header: 'Source', w: 0.6, font: 'condSemi', align: 'center', value: (a) => a.source },
      ],
    });

    H('Constraints', 60);
    drawEngineeringTable(f, {
      rows: p.constraints, rowPad: 2,
      columns: [
        { header: 'ID', w: 0.95, font: 'monoMedium', value: (c) => c.constraintId },
        { header: 'Type', w: 0.7, font: 'condSemi', value: (c) => c.type },
        { header: 'Constraint', w: 3.9, value: (c) => c.description },
        { header: 'Affects', w: 1.6, font: 'mono', value: (c) => c.affectsAssignments.join(' ') || '—' },
        { header: 'Source', w: 0.6, font: 'condSemi', align: 'center', value: (c) => c.source },
      ],
    });

    if (p.objectives.length && p.assignments.length) {
      const hgt = dependencyHeight(p);
      f.figure(hgt, 'Objective → assignment dependency structure', (b) => drawDependencyDiagram(ctx, b, p), { note: 'STRUCTURAL' });
    }
  }

  if (full) {
    H('Validation', 60, `RESULT: ${iap.validation.result}`);
    validationBlock(ctx, f, true);
    H('Approval / sign-off', 90);
  }
  approvalBlock(ctx, f, full);

  if (full) {
    H('Appendix A — Traceability', 60, 'EVERY GENERATED ITEM → SOURCE FIELDS / RULES');
    traceability(ctx, f);
  }
}

/* ================================================================== blocks */

function heading(f: Flow, no: number, title: string, keep: number, note: string | undefined, gap: number) {
  const { ctx } = f;
  if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.IAP_DEBUG) console.error(`  sheet ${ctx.pages.length}  ${p2(no)} ${title}`);
  f.gap(gap);
  f.ensure(17 + keep);
  ctx.font('monoMedium', 8, C.ink);
  ctx.textMid(p2(no), f.x, f.y + 6);
  ctx.font('condSemi', 9.2, C.ink);
  ctx.textMid(title.toUpperCase(), f.x + 20, f.y + 6, { cs: 0.55 });
  if (note) {
    ctx.font('condSemi', T.micro, C.ink3);
    ctx.textMid(note, f.x + f.w - ctx.width(note, 0.3), f.y + 6, { cs: 0.3 });
  }
  ctx.line(f.x, f.y + 13, f.x + f.w, f.y + 13, LW.hair, C.rule);
  ctx.line(f.x, f.y + 13, f.x + 14, f.y + 13, LW.heavy);
  f.y += 18;
}

function titleBlock(ctx: IapPdfContext, f: Flow, compact: boolean) {
  const iap = ctx.iap, h = iap.header;
  const x = f.x, w = f.w;
  let y = f.y;
  ctx.font('condSemi', T.label, C.ink2);
  ctx.textMid('GUARDIANS  ·  INCIDENT ACTION PLAN', x, y + 4, { cs: 0.8 });
  ctx.font('mono', T.label, C.ink2);
  const ref = `${h.documentRef}  REV ${h.revision}`;
  ctx.textMid(ref, x + w - ctx.width(ref), y + 4);
  y += 11;
  ctx.line(x, y, x + w, y, LW.heavy);
  y += compact ? 8 : 12;

  ctx.font('sansSemi', compact ? 19 : 23, C.ink);
  const title = `IAP ${h.iapNo}`;
  ctx.text(title, x, y);
  const tw = ctx.width(title);
  const sw = 132, sh = compact ? 28 : 32;
  const subW = w - tw - 14 - 2 * sw - 16;
  ctx.font('condSemi', compact ? 9 : 10, C.ink);
  const longTitle = `${iap.variant} INCIDENT ACTION PLAN`;
  ctx.textMid(ctx.width(longTitle, 0.5) <= subW ? longTitle : `${iap.variant} IAP`, x + tw + 14, y + (compact ? 8 : 10), { cs: 0.5 });
  ctx.font('cond', T.small, C.ink2);
  ctx.textMid(fit(ctx, h.incidentName, subW), x + tw + 14, y + (compact ? 19 : 22));
  drawStatusStamp(ctx, { x: x + w - sw, y: y - 1, w: sw, h: sh }, [h.status, 'PLAN STATUS'], h.status === 'DRAFT' ? 'critical' : 'ink');
  drawStatusStamp(ctx, { x: x + w - 2 * sw - 8, y: y - 1, w: sw, h: sh }, [iap.validation.result === 'VALID' ? 'VALIDATED' : iap.validation.result === 'VALID_WITH_WARNINGS' ? 'WITH WARNINGS' : 'NOT VALIDATED', 'PLAN VALIDATION'], iap.validation.result === 'INVALID' ? 'critical' : 'ink');
  y += sh + 6;

  const row = (cells: [string, string, number, any?][], rh: number) => {
    let cx = x;
    cells.forEach(([l, v, fr, o]) => {
      drawCell(ctx, { x: cx, y, w: w * fr, h: rh }, l, v, { size: 8, ...o });
      cx += w * fr;
    });
    y += rh;
  };
  const top = y;
  const rh = compact ? 22 : 25;
  row([
    ['IAP No', `${h.iapNo} / REV ${h.revision}`, 0.14, { font: 'monoMedium', size: 9.5 }],
    ['Incident', h.incidentId, 0.22, { font: 'monoMedium', size: 9 }],
    ['Operational period', h.operationalPeriod, 0.38, { font: 'monoMedium' }],
    ['Plan created', utc(h.createdAt), 0.26, {}],
  ], rh);
  row([
    ['Prepared by', h.preparedBy, 0.34, { font: 'cond' }],
    ['Reviewed by', h.reviewedBy, 0.22, { font: 'cond' }],
    ['Approved by', h.approvedBy, 0.22, { font: 'condBold' }],
    ['Built against', h.sitrepRef, 0.22, { font: 'cond' }],
  ], rh);
  ctx.rect({ x, y: top, w, h: y - top }, LW.heavy);
  if (!compact) {
    drawCell(ctx, { x, y, w: w * 0.72, h: 18 }, 'Distribution', h.distribution.join('  ·  '), { font: 'cond', size: 7.4 });
    drawCell(ctx, { x: x + w * 0.72, y, w: w * 0.28, h: 18 }, 'Classification', ctx.iap.demonstration ? 'DEMONSTRATION DATA' : h.classification, { font: 'condBold', size: 7.4 });
    y += 18;
  }
  ctx.rect({ x, y, w, h: 16 }, LW.medium);
  ctx.font('condSemi', T.small, C.ink);
  ctx.textMid(ctx.iap.authorityNotice, x + 5, y + 8, { w: w - 10 });
  y += 16;
  if (iap.demonstration) {
    ctx.fillRect({ x, y, w, h: 15 }, C.ink);
    ctx.font('condBold', 8, C.paper);
    ctx.textMid(DEMO_MARKING, x, y + 7.5, { w, align: 'center', cs: 1 });
    y += 15;
  }
  f.y = y + 6;
}

function alertsBlock(ctx: IapPdfContext, f: Flow, full: boolean) {
  const alerts = ctx.iap.plan.alerts.filter((a) => full || a.severity !== 'NOTICE');
  if (!alerts.length) return;
  const tagW = 62, pad = 4;
  const heights = alerts.map((a) => {
    ctx.font('sansMedium', T.small + 0.4);
    return Math.max(14, ctx.height(a.text, { w: f.w - tagW - 14 }) + 2 * pad);
  });
  f.ensure(heights.reduce((s, x) => s + x, 0) + 4);
  const top = f.y;
  const critical = alerts.some((a) => a.severity === 'CRITICAL');
  alerts.forEach((a, i) => {
    const hgt = heights[i];
    const tag = { x: f.x + 3, y: f.y + 3, w: tagW, h: hgt - 6 };
    const isC = a.severity === 'CRITICAL', isN = a.severity === 'NOTICE';
    ctx.rect(tag, isN ? LW.fine : isC ? LW.heavy : LW.medium, isN ? C.ink2 : isC ? C.critical : C.ink, isN ? C.paper : isC ? C.critical : C.ink, isN ? DASH.short : null);
    ctx.font('condBold', T.small, isN ? C.ink2 : C.paper);
    ctx.textMid(a.severity, tag.x, tag.y + tag.h / 2, { w: tagW, align: 'center', cs: 0.8 });
    ctx.font(isN ? 'sans' : 'sansMedium', T.small + 0.4, isC ? C.critical : C.ink);
    const th = ctx.height(a.text, { w: f.w - tagW - 14 });
    ctx.text(a.text, f.x + tagW + 10, f.y + (hgt - th) / 2 + 0.5, { w: f.w - tagW - 14 });
    f.y += hgt;
    if (i < alerts.length - 1) ctx.line(f.x, f.y, f.x + f.w, f.y, LW.hair, C.grid);
  });
  ctx.rect({ x: f.x, y: top, w: f.w, h: f.y - top }, critical ? LW.heavy : LW.medium, critical ? C.critical : C.ink);
  f.y += 3;
}

function emphasis(ctx: IapPdfContext, f: Flow, text: string) {
  const tagW = 92;
  ctx.font('sansMedium', T.body);
  const th = ctx.height(text, { w: f.w - tagW - 14, lineGap: 1.6 });
  const hgt = Math.max(20, th + 9);
  f.ensure(hgt);
  ctx.rect({ x: f.x, y: f.y, w: f.w, h: hgt }, LW.medium);
  ctx.fillRect({ x: f.x, y: f.y, w: tagW, h: hgt }, C.tint);
  ctx.line(f.x + tagW, f.y, f.x + tagW, f.y + hgt, LW.fine);
  ctx.font('condBold', T.small, C.ink);
  ctx.textMid('COMMAND', f.x + 6, f.y + hgt / 2 - 5, { cs: 0.5 });
  ctx.textMid('EMPHASIS', f.x + 6, f.y + hgt / 2 + 5, { cs: 0.5 });
  ctx.font('sansMedium', T.body, C.ink);
  ctx.text(text, f.x + tagW + 8, f.y + (hgt - th) / 2, { w: f.w - tagW - 14, lineGap: 1.6 });
  f.y += hgt + 4;
}

function priorityTagBox(ctx: ReportContext, pri: Priority, x: number, yc: number, w: number, hh = 10) {
  const b = { x, y: yc - hh / 2, w, h: hh };
  const tone = PRI_TONE[pri];
  ctx.rect(b, tone.fill ? LW.fine : LW.medium, tone.fill ? C.ink : C.ink, tone.fill ? C.ink : undefined, tone.dash);
  ctx.font('condBold', T.micro, tone.fill ? C.paper : C.ink);
  ctx.textMid(priorityTag(pri), b.x, yc, { w, align: 'center', cs: 0.3 });
}

function assignmentBlock(ctx: IapPdfContext, f: Flow, a: Assignment, ref: string) {
  const w = f.w, labelW = 74;
  const rows: [string, string][] = [
    ['Task', a.task],
    ['Assigned', `${a.assignedUnit}${a.assetIds.length ? `  [${a.assetIds.join(', ')}]` : ''}  ·  ${a.location}${a.sectorId ? ` (sector ${a.sectorId})` : ''}`],
    ['Timing', a.startTime ? `Start ${hhmm(a.startTime, ref)} · on scene ${a.onSceneTime ? hhmm(a.onSceneTime, ref) : 'TRANSIT TIME NOT AVAILABLE'} · complete ${hhmm(a.targetCompletion, ref)}${a.commitUntil ? ` · assets held to ${hhmm(a.commitUntil, ref)}` : ''} UTC${a.assumptionIds.length ? `  ·  assumes ${a.assumptionIds.join(', ')} (REQUIRE CONFIRMATION)` : ''}` : `NOT SCHEDULED — ${a.status}: ${a.statusReason ?? ''}`],
    ['Depends on', `${depText(a)}${a.requiredInformation.length ? `  ·  needs: ${a.requiredInformation.join(' · ')}` : ''}`],
    ['Success', `${a.successCriteria.join(' · ')}  ·  FALLBACK: ${a.fallbackAction}`],
    ['Safety', a.safetyNotes.join(' · ') || 'No hazard mapped to this task'],
  ];
  ctx.font('sans', T.small);
  const heights = rows.map(([, v]) => Math.max(11, ctx.height(v, { w: w - labelW - 10 }) + 4));
  const hgt = 14 + heights.reduce((s, x) => s + x, 0);
  f.ensure(hgt + 4);
  const top = f.y;
  // header strip
  ctx.fillRect({ x: f.x, y: f.y, w, h: 14 }, C.tint);
  ctx.font('monoMedium', 8.6, C.ink);
  ctx.textMid(a.assignmentId, f.x + 4, f.y + 7, { cs: 0.4 });
  const tagX = f.x + 8 + Math.max(66, ctx.width(a.assignmentId, 0.4) + 6);
  priorityTagBox(ctx, a.priority, tagX, f.y + 7, 58, 9.5);
  ctx.font('cond', T.small, C.ink2);
  ctx.textMid(fit(ctx, `OBJECTIVE ${a.objectiveId}  ·  ${a.activity}  ·  ${a.source}`, f.w - (tagX - f.x) - 64 - 66), tagX + 64, f.y + 7);
  ctx.font('condBold', T.small, a.startTime ? C.ink : C.critical);
  const st = a.status;
  ctx.textMid(st, f.x + w - ctx.width(st) - 5, f.y + 7, { cs: 0.4 });
  ctx.line(f.x, f.y + 14, f.x + w, f.y + 14, LW.fine);
  f.y += 14;
  rows.forEach(([k, v], i) => {
    ctx.font('cond', T.label, C.ink3);
    ctx.textMid(k.toUpperCase(), f.x + 4, f.y + heights[i] / 2, { cs: 0.3 });
    ctx.font(i === 0 ? 'sansMedium' : 'sans', T.small, C.ink);
    ctx.text(v, f.x + labelW, f.y + (heights[i] - ctx.height(v, { w: w - labelW - 10 })) / 2 + 0.5, { w: w - labelW - 10 });
    f.y += heights[i];
    if (i < rows.length - 1) ctx.line(f.x + labelW - 6, f.y, f.x + w, f.y, LW.hair, C.faint);
  });
  ctx.rect({ x: f.x, y: top, w, h: f.y - top }, a.priority === 'P1' ? LW.heavy : LW.medium);
  ctx.line(f.x + labelW - 6, top + 14, f.x + labelW - 6, f.y, LW.hair, C.grid);
  f.y += 5;
}

function triggerBlock(ctx: IapPdfContext, f: Flow, t: IapDocument['plan']['decisionTriggers'][number], full: boolean) {
  const w = f.w, tagW = 58;
  const rows: [string, string][] = [
    ['IF', t.condition],
    ['THEN', t.action],
    ['REQUIRES', t.requires.join(' · ')],
    ...(full ? [['AUTHORITY', `${t.decisionAuthority}${t.decideBy ? ` · decide by ${utc(t.decideBy)}` : ''}`] as [string, string]] : []),
    ...(full && t.affectedAssignments.length ? [['AFFECTS', t.affectedAssignments.join(', ')] as [string, string]] : []),
    ...(full && t.thresholdSource ? [['THRESHOLD', `From ${t.thresholdSource}`] as [string, string]] : []),
  ];
  ctx.font('sans', T.small);
  const heights = rows.map(([, v]) => Math.max(10.5, ctx.height(v, { w: w - tagW - 100 }) + 3));
  const hgt = 12 + heights.reduce((s, x) => s + x, 0);
  f.ensure(hgt + 3);
  const top = f.y;
  ctx.font('monoMedium', 8.2, C.ink);
  ctx.textMid(t.triggerId, f.x + 4, f.y + 6);
  ctx.font('condBold', T.micro, t.status === 'ARMED' ? C.ink : C.critical);
  ctx.textMid(t.status, f.x + w - ctx.width(t.status, 0.4) - 4, f.y + 6, { cs: 0.4 });
  ctx.line(f.x, f.y + 12, f.x + w, f.y + 12, LW.hair, C.grid);
  f.y += 12;
  rows.forEach(([k, v], i) => {
    ctx.font('condBold', T.label, k === 'IF' || k === 'THEN' ? C.ink : C.ink3);
    ctx.textMid(k, f.x + 8, f.y + heights[i] / 2, { cs: 0.5 });
    ctx.font(k === 'THEN' ? 'sansMedium' : 'sans', T.small, C.ink);
    ctx.text(v, f.x + tagW, f.y + (heights[i] - ctx.height(v, { w: w - tagW - 8 })) / 2, { w: w - tagW - 8 });
    f.y += heights[i];
  });
  ctx.rect({ x: f.x, y: top, w, h: f.y - top }, LW.fine);
  f.y += 4;
}

function twoColumnFacts(ctx: ReportContext, f: Flow, rows: [string, string][]) {
  const half = Math.ceil(rows.length / 2), gap = 14, w = (f.w - gap) / 2;
  const left = rows.slice(0, half), right = rows.slice(half);
  ctx.font('sans', T.table);
  const est = Math.max(...[left, right].map((col) => col.reduce((s, [, v]) => s + Math.max(13, ctx.height(v, { w: w * 0.6 - 8 }) + 5), 0)));
  f.ensure(est);
  const startY = f.y;
  f.keyValues(left, { w, labelW: w * 0.38 });
  const yL = f.y;
  f.y = startY;
  f.keyValues(right, { x: f.x + w + gap, w, labelW: w * 0.38 });
  f.y = Math.max(yL, f.y) + 4;
}

function changesBlock(ctx: IapPdfContext, f: Flow) {
  const c = ctx.iap.changes;
  if (c.initial) {
    f.ensure(22);
    drawStatusStamp(ctx, { x: f.x, y: f.y, w: f.w, h: 20 }, ['INITIAL IAP — NO PREVIOUS OPERATIONAL PERIOD']);
    f.y += 24;
    return;
  }
  const deltas = c.deltas.filter((d) => d.kind !== 'UNCHANGED').slice(0, 18);
  if (!deltas.length) { f.para('No reportable changes since the previous IAP.', { size: T.body }); return; }
  const ind = 72, size = T.small + 0.3;
  for (const kind of KIND_ORDER as DeltaKind[]) {
    const items = deltas.filter((d) => d.kind === kind);
    if (!items.length) continue;
    ctx.font('sans', size);
    f.ensure(ctx.height(items[0].text, { w: f.w - ind - 8, lineGap: 1.3 }) + 8);
    f.gap(2);
    deltaTag(ctx, kind, f.x, f.y + 5.5);
    items.forEach((d, i) => {
      ctx.font(d.significance === 'HIGH' ? 'sansMedium' : 'sans', size);
      const hgt = ctx.height(d.text, { w: f.w - ind - 8, lineGap: 1.3 });
      if (i) f.ensure(hgt + 2);
      ctx.doc.rect(f.x + ind, f.y + 3.4, 2.4, 2.4).fill(kind === 'UNCHANGED' ? C.ink3 : C.ink);
      ctx.font(d.significance === 'HIGH' ? 'sansMedium' : 'sans', size, kind === 'UNCHANGED' ? C.ink2 : C.ink);
      ctx.text(d.text, f.x + ind + 8, f.y, { w: f.w - ind - 8, lineGap: 1.3 });
      f.y += hgt + 2.2;
    });
    ctx.line(f.x + ind, f.y, f.x + f.w, f.y, LW.hair, C.faint);
  }
  if (c.deltas.length > deltas.length) f.para(`${c.deltas.length - deltas.length} further change(s), including unchanged key facts, are listed in iap.md / iap.json.`, { size: T.label, color: C.ink3, gapAfter: 0 });
  f.y += 3;
}

function deltaTag(ctx: ReportContext, kind: DeltaKind, x: number, yc: number, w = 62, hh = 11) {
  const b = { x, y: yc - hh / 2, w, h: hh };
  let color: string = C.ink;
  switch (kind) {
    case 'NEW': ctx.rect(b, LW.fine, C.ink, C.ink); color = C.paper; break;
    case 'CHANGED': ctx.rect(b, LW.medium, C.ink); break;
    case 'DEGRADED': ctx.hatch({ x: b.x, y: b.y, w: 10, h: hh }, 2, LW.hair, C.ink); ctx.rect(b, LW.medium, C.ink); ctx.line(b.x + 10, b.y, b.x + 10, b.y + hh, LW.fine); break;
    case 'RESOLVED': ctx.rect(b, LW.fine, C.ink, undefined, DASH.short); break;
    case 'COMPLETED': ctx.rect(b, LW.medium, C.ink2, C.tint); color = C.ink; break;
    case 'CANCELLED': ctx.rect(b, LW.fine, C.rule, undefined, DASH.dashed); color = C.ink3; break;
    case 'UNCHANGED': ctx.rect(b, LW.medium, C.rule, undefined, DASH.dotted); color = C.ink3; break;
  }
  ctx.font('condBold', T.label, color);
  const off = kind === 'DEGRADED' ? 10 : 0;
  ctx.textMid(kind, b.x + off, yc, { w: w - off, align: 'center', cs: 0.4 });
}

function validationBlock(ctx: IapPdfContext, f: Flow, full: boolean) {
  const v = ctx.iap.validation;
  const issues = full ? v.issues : v.issues.filter((i) => i.severity !== 'INFO');
  const counts = (['ERROR', 'WARNING', 'INFO'] as const).map((s) => `${s}: ${v.issues.filter((i) => i.severity === s).length}`).join('  ·  ');
  f.ensure(24);
  ctx.rect({ x: f.x, y: f.y, w: f.w, h: 18 }, v.result === 'INVALID' ? LW.heavy : LW.medium, v.result === 'INVALID' ? C.critical : C.ink);
  ctx.font('condBold', 9, v.result === 'INVALID' ? C.critical : C.ink);
  ctx.textMid(VALIDATION_STAMP[v.result], f.x + 6, f.y + 9, { cs: 0.6 });
  ctx.font('mono', T.small, C.ink2);
  ctx.textMid(counts, f.x + f.w - ctx.width(counts) - 6, f.y + 9);
  f.y += 22;
  if (!full) {
    const top3 = issues.slice(0, 3);
    if (top3.length) f.para(top3.map((i) => `${i.severity} ${i.code}: ${i.message}`).join('  ·  '), { size: T.small, gapAfter: 2 });
    else f.para('All checks passed. Full issue list in the FULL IAP and in iap.json.', { size: T.small, gapAfter: 2 });
    return;
  }
  if (!issues.length) { f.para('All checks passed: assignments reference valid objectives and assets, asset availability and operating limits are respected, no resource conflicts or dependency cycles, and every generated item is traceable.', { size: T.small }); return; }
  drawEngineeringTable(f, {
    rows: issues, rowPad: 1.8,
    columns: [
      { header: 'Severity', w: 0.8, font: 'condBold', value: (i) => i.severity },
      { header: 'Check', w: 1.5, font: 'mono', value: (i) => i.code },
      { header: 'Finding', w: 5.2, value: (i) => i.message },
      { header: 'Refs', w: 1.3, font: 'mono', value: (i) => i.refs.join(' ') },
    ],
  });
}

function approvalBlock(ctx: IapPdfContext, f: Flow, full: boolean) {
  const h = ctx.iap.header;
  if (!full) {
    // QUICK: validation state, signatures and the authority notice in one compact tail block
    const v = ctx.iap.validation;
    const top = v.issues.filter((i) => i.severity !== 'INFO').slice(0, 2);
    const line = `${VALIDATION_STAMP[v.result]}${top.length ? ` — ${top.map((i) => `${i.code}: ${i.message}`).join(' · ')}` : ' — all checks passed'}`;
    ctx.font('cond', T.label, C.ink);
    const lh = ctx.height(line, { w: f.w - 76 });
    const hgt = 30 + lh;
    f.gap(4);
    f.ensure(hgt + 2);
    const top0 = f.y;
    ctx.font('condBold', T.label, v.result === 'INVALID' ? C.critical : C.ink);
    ctx.textMid('PLAN VALIDATION', f.x + 5, f.y + 7, { cs: 0.4 });
    ctx.font('cond', T.label, v.result === 'INVALID' ? C.critical : C.ink);
    ctx.text(line, f.x + 76, f.y + 3, { w: f.w - 80 });
    f.y += 8 + lh;
    ctx.line(f.x, f.y, f.x + f.w, f.y, LW.hair, C.grid);
    ctx.font('cond', T.zone, C.ink3);
    ctx.textMid('PREPARED / REVIEWED / APPROVED — SIGNATURES', f.x + 5, f.y + 6, { cs: 0.4 });
    ctx.font('condMedium', T.small, C.ink);
    ctx.textMid(fit(ctx, `${h.preparedBy}  ·  ${h.reviewedBy}  ·  ${h.approvedBy}`, f.w - 10), f.x + 5, f.y + 15);
    ctx.font('cond', T.zone, C.ink3);
    ctx.textMid(fit(ctx, ctx.iap.authorityNotice, f.w - 10), f.x + 5, f.y + 21);
    f.y += 24;
    ctx.rect({ x: f.x, y: top0, w: f.w, h: f.y - top0 }, LW.medium, v.result === 'INVALID' ? C.critical : C.ink);
    f.y += 4;
    return;
  }
  f.para(ctx.iap.authorityNotice, { size: T.small, font: 'sansMedium', gapAfter: 4 });
  f.ensure(56);
  const w = f.w / 3, hgt = 46;
  const cells: [string, string, string][] = [
    ['PREPARED BY', h.preparedBy, utc(h.createdAt)],
    ['REVIEWED BY', h.reviewedBy, h.reviewedBy === 'NOT REVIEWED' ? '—' : 'Signature / time'],
    ['APPROVED BY', h.approvedBy, h.approvedAt],
  ];
  cells.forEach(([label, name, when], i) => {
    const b = { x: f.x + i * w, y: f.y, w, h: hgt };
    ctx.rect(b, LW.medium);
    ctx.font('cond', T.zone, C.ink3);
    ctx.textMid(label, b.x + 4, b.y + 6, { cs: 0.4 });
    ctx.font('condMedium', T.small, C.ink);
    ctx.text(name, b.x + 4, b.y + 11, { w: w - 8 });
    ctx.line(b.x + 4, b.y + hgt - 13, b.x + w - 4, b.y + hgt - 13, LW.hair, C.rule, DASH.short);
    ctx.font('cond', T.zone, C.ink3);
    ctx.textMid(`SIGNATURE  ·  ${when}`, b.x + 4, b.y + hgt - 6);
  });
  f.y += hgt + 4;
  ctx.font('cond', T.label, C.ink3);
  ctx.textMid(`Command authority: ${ctx.iap.header.commandAuthority}${ctx.iap.demonstration ? '  ·  demonstration plans remain unapproved' : ''}`, f.x, f.y + 4);
  f.y += 10;
}

function traceability(ctx: IapPdfContext, f: Flow) {
  const p = ctx.iap.plan;
  const rows = [
    ...p.objectives.map((o) => ({ id: o.objectiveId, from: o.derivedFrom })),
    ...p.assignments.map((a) => ({ id: a.assignmentId, from: a.derivedFrom })),
    ...p.decisionTriggers.map((t) => ({ id: t.triggerId, from: t.derivedFrom })),
    ...p.contingencies.map((c) => ({ id: c.contingencyId, from: c.derivedFrom })),
  ];
  drawEngineeringTable(f, {
    rows, rowPad: 1, fontSize: T.zone,
    columns: [
      { header: 'Item', w: 1, font: 'monoMedium', value: (r) => r.id },
      { header: 'Derived from (input fields / rules)', w: 4.6, font: 'mono', value: (r) => r.from.join('  ') },
    ],
  });
  f.para(`Alerts, information gaps, assumptions and constraints carry their traceability in iap.json (every item has derivedFrom). Plan graph: ${p.graph.nodes.length} nodes / ${p.graph.edges.length} edges (objective → assignment → asset · dependency · trigger). Machine-readable in iap.json → plan.graph.`, { size: T.label, color: C.ink3, gapAfter: 0 });
}

/* ================================================================== frame */

function finalize(ctx: IapPdfContext) {
  const iap = ctx.iap, h = iap.header;
  const total = ctx.pages.length;
  const range = ctx.doc.bufferedPageRange();
  const W = PAGE.a4.w, Hh = PAGE.a4.h, fr = PAGE.frame;
  for (let i = 0; i < total; i++) {
    ctx.doc.switchToPage(range.start + i);
    drawTechnicalFrame(ctx, W, Hh);

    const hh = PAGE.headerH, x0 = fr, x1 = W - fr, y = fr;
    ctx.line(x0, y + hh, x1, y + hh, LW.medium);
    ctx.font('monoMedium', 8.5);
    ctx.textMid(h.iapNo, x0, y + hh / 2, { w: 34, align: 'center' });
    ctx.line(x0 + 34, y, x0 + 34, y + hh, LW.fine);
    const tagW = 150, refW = 132;
    ctx.font('condSemi', 7.6, C.ink);
    ctx.textMid(fit(ctx, `GUARDIANS ${iap.variant} IAP  ·  OP PERIOD ${h.operationalPeriod}${i ? '  (CONT.)' : ''}`, x1 - tagW - refW - x0 - 52, 0.4), x0 + 42, y + hh / 2, { cs: 0.4 });
    ctx.line(x1 - tagW - refW, y, x1 - tagW - refW, y + hh, LW.fine);
    ctx.font('mono', T.label, C.ink2);
    ctx.textMid(`${h.documentRef} · REV ${h.revision}`, x1 - tagW - refW, y + hh / 2, { w: refW, align: 'center' });
    const tag = { x: x1 - tagW, y, w: tagW, h: hh };
    if (iap.demonstration) {
      ctx.fillRect(tag, C.ink);
      ctx.font('condBold', 6.8, C.paper);
      ctx.textMid('DEMONSTRATION / ILLUSTRATIVE DATA', tag.x, y + hh / 2, { w: tagW, align: 'center', cs: 0.35 });
    } else {
      ctx.line(tag.x, y, tag.x, y + hh, LW.fine);
      ctx.font('condBold', 6.8, C.ink);
      ctx.textMid(h.classification, tag.x, y + hh / 2, { w: tagW, align: 'center', cs: 0.35 });
    }

    const fh = PAGE.footerH, fy = Hh - fr - fh, inner = W - 2 * fr, logoW = 128, sheetW = 56, mid = inner - logoW - sheetW, rh = fh / 2;
    ctx.rect({ x: x0, y: fy, w: logoW, h: fh }, LW.fine);
    drawLogo(ctx, { x: x0 + 5, y: fy + 6, w: 24, h: 24 });
    ctx.font('condBold', 9, C.ink);
    ctx.textMid('GUARDIANS', x0 + 35, fy + 11, { cs: 1 });
    ctx.font('cond', T.zone, C.ink2);
    ctx.text(h.systemName, x0 + 35, fy + 17, { w: logoW - 39, lineGap: -0.5 });
    const row = (cells: [string, string, number, any?][], yy: number) => {
      let xx = x0 + logoW;
      for (const [l, v, fracW, o] of cells) {
        drawCell(ctx, { x: xx, y: yy, w: mid * fracW, h: rh }, l, v, o);
        xx += mid * fracW;
      }
    };
    row([
      ['Document ref.', h.documentRef, 0.3],
      ['Incident ID', h.incidentId, 0.26],
      ['Rev', String(h.revision), 0.08, { font: 'monoMedium', align: 'center' }],
      ['Classification', iap.demonstration ? 'DEMONSTRATION DATA' : h.classification, 0.36, { font: 'condBold' }],
    ], fy);
    row([
      ['Operational period', h.operationalPeriod, 0.46, { font: 'monoMedium' }],
      ['Plan status', h.status, 0.2, { font: 'condSemi' }],
      ['Validation', VALIDATION_STAMP[iap.validation.result], 0.34, { font: 'condSemi' }],
    ], fy + rh);
    const sb = { x: x0 + inner - sheetW, y: fy, w: sheetW, h: fh };
    ctx.rect(sb, LW.fine);
    ctx.font('cond', T.zone, C.ink3);
    ctx.textMid('SHEET', sb.x + 3, fy + 5.2, { cs: 0.35 });
    ctx.font('monoMedium', 12, C.ink);
    ctx.textMid(p2(i + 1), sb.x, fy + 17, { w: sheetW, align: 'center' });
    ctx.font('mono', T.label, C.ink2);
    ctx.textMid(`OF ${p2(total)}`, sb.x, fy + 29, { w: sheetW, align: 'center' });
    ctx.rect({ x: x0, y: fy, w: inner, h: fh }, LW.heavy);
  }
}

