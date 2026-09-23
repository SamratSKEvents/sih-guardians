/**
 * Frozen incident results, with a small static fallback for the prototype.
 *
 * No planner service is called. Only the fields the Response stage reads are
 * typed here; unsupported records receive clearly labeled mock output.
 */

export type ExecutionStatus = 'SUCCESS' | 'PARTIAL' | 'SKIPPED' | 'INSUFFICIENT_DATA' | 'FAILED';

export interface ModuleExecution {
  status: ExecutionStatus;
  reasons: string[];
  counts?: { items: number; actionable: number; rejected: number };
}

/** One action the planners put in the SITREP feed. Older orchestrators send bare objects. */
export interface PlannedAction {
  id?: string;
  title?: string;
  detail?: string;
  due?: string;
  owner?: string;
}

export type LayerState = 'AVAILABLE' | 'PARTIAL' | 'NOT_AVAILABLE' | 'UNKNOWN' | 'NOT_EVALUATED';

export interface IncidentAnalysis {
  schema: 'guardians-analysis/1';
  incidentId: string;
  generatedAt: string;
  incident: { timeAnchor: string | null; layers: Record<string, { state: LayerState; reason: string | null }> };
  execution: Record<string, ModuleExecution>;
  alerts: {
    alerts: { alertId: string; severity: 'CRITICAL' | 'WARNING' | 'NOTICE'; title: string; explanation: string; lifecycle: string }[];
  } | null;
  conflicts: { source: string; ref: string; description: string }[];
  iap: { document: { validation: { result: 'VALID' | 'VALID_WITH_WARNINGS' | 'INVALID' } }; mapped: unknown[]; unmapped: unknown[] } | null;
  sitrep: { feed: { warnings: unknown[]; actions: PlannedAction[] }; document: unknown | null };
  limitations: string[];
}

const MOCK_ANALYSIS: IncidentAnalysis = {
  schema: 'guardians-analysis/1',
  incidentId: 'demo-static',
  generatedAt: '2026-09-23T00:00:00Z',
  incident: { timeAnchor: null, layers: {} },
  execution: Object.fromEntries(
    ['containment', 'assetPrepositioning', 'surveillance', 'cleanup', 'sampling', 'alerts', 'protection'].map((key) => [
      key,
      { status: 'INSUFFICIENT_DATA', reasons: ['Static demo: no incident-specific response inputs are bundled.'] },
    ]),
  ),
  alerts: null,
  conflicts: [],
  iap: null,
  sitrep: { feed: { warnings: [], actions: [] }, document: null },
  limitations: ['Static prototype data. No live planners or response services are connected.'],
};

export async function analyzeIncident(incidentId: string): Promise<IncidentAnalysis> {
  // A bundle may carry a saved planner result. Nothing posts to a server.
  const frozen = await fetch(`/data/incidents/${encodeURIComponent(incidentId)}/analysis.json`);
  if (frozen.ok && frozen.headers.get('content-type')?.includes('json')) return frozen.json() as Promise<IncidentAnalysis>;
  return { ...MOCK_ANALYSIS, incidentId };
}
