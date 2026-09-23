/**
 * One slick, investigated.
 *
 * Two columns that never unmount: the stage and the summary. The slick stays present while the operator walks the chain, which
 * is the whole difference between this and the card wall it replaces — there,
 * every question was a box of its own and the thing under investigation was
 * never on screen at all.
 *
 * The stages are a dependency chain — Detection → Origin → Vessels →
 * Forecast → Response — and each one is only as good as the last. They used to
 * have a column of their own down the left, which spent 13rem of the widest
 * thing on the screen restating what the stage's own gap panels already say.
 * The switcher is now one strip in the head; each stage still reports its own
 * state, on hover and in its own body.
 *
 * Nothing here invents a number. Where the answer does not exist, the stage
 * says so, and says why, in the pipeline's own words.
 */

import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Database, Download, FlaskConical, House, LayoutGrid, Map as MapIcon, Pentagon, Plane, Satellite, Shield, Ship, Waves } from 'lucide-react';
import { SceneView } from './stages/Scene';
import { MapPage } from './stages/MapPage';
import { ProvenancePage } from './stages/Provenance';
import { Badge, Failed, Skeleton } from '../../design/components';
import { fetchSlick, type SlickFeature } from '../../api/slicks';
import { fetchIncident, resolveIncidentId } from '../../api/incidents';
import type { Incident } from '../../incidents/types';
import { STATE_LABEL, STATE_STATUS } from '../../incidents/words';
import { SOURCES, when } from '../../format';
import { seaName } from '../../seas';
import { STAGES, stageState } from './stages';

/*
 * Three tabs, in the top bar where the record is identified rather than in the
 * rail: switching what the whole surface is about is not a detail of the
 * detail column. Response is marked because it is the only one that asks for a
 * decision; the other two describe.
 */
const TABS = [
  { id: 'detection', label: 'Detection' },
  { id: 'temporal', label: 'Forecast & impact' },
  { id: 'response', label: 'Response', accent: true },
] as const;
import { SlickChart, StageHosts } from './StageFrame';
import { ForecastProvider } from '../../forecast/context';
import { DetectionStage } from './stages/Detection';
import { OriginStage } from './stages/Origin';
import { VesselsStage } from './stages/Vessels';
import { ForecastStage } from './stages/Forecast';
import { ResponseStage } from './stages/Response';
import { EvidenceStage } from './stages/Evidence';
import './workspace.css';

export interface StageProps {
  slick: SlickFeature;
  incident: Incident | undefined;
  incidentId: string | undefined;
  detectionPanel: DetectionPanel;
  forecastPanel: ForecastPanel;
  forecastDirection: ForecastDirection;
  setForecastDirection: (direction: ForecastDirection) => void;
  responsePanel: ResponsePanel;
  setResponsePanel: (panel: ResponsePanel) => void;
}

export type DetectionPanel = 'scene' | 'map' | 'overview' | 'geometry' | 'vessels' | 'lookalike' | 'provenance';
export type ForecastPanel = 'overview' | 'environment' | 'impact' | 'vessels';
export type ForecastDirection = 'forward' | 'backward';
export type ResponsePanel = 'overview' | 'containment' | 'assets' | 'surveillance' | 'cleanup' | 'sampling' | 'alerts';

const FORECAST_PANELS = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'environment', label: 'Environmental data', icon: Database },
  { id: 'impact', label: 'Shoreline impact', icon: Pentagon },
  { id: 'vessels', label: 'Vessel context', icon: Ship },
] as const;

const RESPONSE_PANELS = [
  { id: 'overview', label: 'Overview', icon: House },
  { id: 'containment', label: 'Containment', icon: Shield },
  { id: 'assets', label: 'Assets', icon: Ship },
  { id: 'surveillance', label: 'Surveillance', icon: Plane },
  { id: 'cleanup', label: 'Cleanup', icon: Waves },
  { id: 'sampling', label: 'Sampling', icon: FlaskConical },
  { id: 'alerts', label: 'Alerts', icon: Bell },
] as const;

/* Detection is three pages, switched from the head: the scene, the map around it, and how it was made. */
const DETECTION_PAGES = [
  { id: 'scene', label: 'Scene', icon: Satellite },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'provenance', label: 'Data & provenance', icon: Database },
] as const;

/** What was seen and how it is known, as one page: the evidence is part of the detection. */
function DetectionWithEvidence(props: StageProps) {
  return (
    <>
      <DetectionStage {...props} />
      {props.detectionPanel === 'provenance' && <EvidenceStage {...props} embedded />}
    </>
  );
}

const BODIES: Record<string, (props: StageProps) => React.ReactNode> = {
  detection: DetectionWithEvidence,
  origin: OriginStage,
  vessels: VesselsStage,
  forecast: ForecastStage,
  response: ResponseStage,
};

export function Workspace({ slickId }: { slickId: string }) {
  const [slick, setSlick] = useState<SlickFeature | 'error'>();
  const [incident, setIncident] = useState<Incident>();
  const [tabId, setTabId] = useState<(typeof TABS)[number]['id']>('detection');
  const [detectionPanel, setDetectionPanel] = useState<DetectionPanel>('scene');
  const [forecastPanel, setForecastPanel] = useState<ForecastPanel>('overview');
  const [forecastDirection, setForecastDirection] = useState<ForecastDirection>('forward');
  const [responsePanel, setResponsePanel] = useState<ResponsePanel>('overview');
  // Which stage of the open tab is on the chart. Undefined means its first.
  const [stageId, setStageId] = useState<string>();
  // Where a stage's chart is portalled to, and how wide the operator has
  // dragged the column that holds everything else.
  const [mapHost, setMapHost] = useState<HTMLDivElement | null>(null);
  const [dockHost, setDockHost] = useState<HTMLDivElement | null>(null);
  // Whether the open stage drew its own chart. When it did not — it returned a
  // gap panel instead — the map still shows the thing under investigation.
  const [hasChart, setHasChart] = useState(false);
  const [railWidth, setRailWidth] = useState(340);
  const grab = useRef<{ x: number; width: number } | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setSlick(undefined);
    setIncident(undefined);
    setTabId('detection');
    setDetectionPanel('scene');
    setForecastPanel('overview');
    setForecastDirection('forward');
    setResponsePanel('overview');
    setStageId(undefined);
    fetchSlick(slickId)
      .then((feature) => {
        if (!current) return;
        setSlick(feature);
        const id = resolveIncidentId(feature);
        // Only the flagship demo record has a full investigation bundle.
        if (id) {
          fetchIncident(id)
            .then((bundle) => current && setIncident(bundle))
            .catch(() => undefined);
        }
      })
      .catch(() => current && setSlick('error'));
    return () => {
      current = false;
    };
  }, [slickId]);

  if (slick === 'error') {
    return (
      <div className="ws ws-bare">
        <Failed title="Could not load this detection" detail={slickId} onRetry={() => setSlick(undefined)} />
      </div>
    );
  }

  if (!slick) {
    return (
      <div className="ws ws-bare" aria-busy="true">
        <Skeleton head rows={10} />
      </div>
    );
  }

  const p = slick.properties;
  const incidentId = resolveIncidentId(slick);
  // The incident's own subtitle already names the water ("Baie de Seine, off
  // Le Havre"); only the sea lookup needs the preposition putting in front.
  const place = incident?.subtitle || (seaName(p.centroid) ? `Off ${seaName(p.centroid)}` : undefined);

  /*
   * Prefer the bundle's acquisition time over the record's.
   *
   * Most catalog records have no real acquisition time and carry one assigned
   * by a hash of their id, marked ASSIGNED_DEMO. Where an incident bundle
   * exists it has the measured time — for the CleanSeaNet case, 13 Jan 2021,
   * not the 2026 date the importer invented. Showing the invented one while
   * holding the real one would be the exact failure this console is built to
   * avoid, and it is only visible on a screen that puts both in reach.
   */
  const measuredAt = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : undefined;
  const observedAt = measuredAt ?? Date.parse(p.observedAt);
  const assigned = measuredAt === undefined && p.timeSource === 'ASSIGNED_DEMO';
  const inTab = STAGES.filter((item) => item.group === tabId);
  // Temporal forecast opens on the animated forward run, not the backtrack.
  const defaultStage = tabId === 'temporal' ? 'forecast' : tabId === 'response' ? 'response' : 'detection';
  const stage = inTab.find((item) => item.id === stageId) ?? inTab.find((item) => item.id === defaultStage) ?? inTab[0];
  const Body = BODIES[stage.id] ?? DetectionStage;

  return (
    <div className="ws" style={{ ['--rail-w' as string]: tabId === 'detection' && railWidth === 340 ? '40%' : `${railWidth}px` }}>
      <header className="ws-top">
        <h2>{place ?? SOURCES[String(p.kind)] ?? String(p.source)}</h2>
        <span className="ws-id mono">{slick.id}</span>

        <nav className="ws-tabs" aria-label="Investigation">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ws-tab"
              data-accent={'accent' in item && item.accent ? '' : undefined}
              aria-current={item.id === tabId ? 'page' : undefined}
              onClick={() => {
                setTabId(item.id);
                setStageId(undefined);
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {tabId === 'detection' && (
          <div className="ws-pages" role="group" aria-label="Detection pages">
            {DETECTION_PAGES.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-pressed={detectionPanel === id} onClick={() => setDetectionPanel(id)}>
                <Icon size={14} />{label}
              </button>
            ))}
          </div>
        )}

        {incident && (
          <Badge status={STATE_STATUS(incident.attributionStatus)}>
            Attribution {STATE_LABEL(incident.attributionStatus).toLowerCase()}
          </Badge>
        )}
        {p.lookalikeWarning === true && <Badge status="warning">Possible look-alike</Badge>}

        {/* The time sits with the export at the far end: both are things you
          * take away from the record rather than things you read it by. */}
        <span className="ws-when num">{when.format(observedAt)} UTC</span>

        <details className="ws-export">
          <summary>
            <Download size={15} />
            Download
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <div className="ws-export-menu" role="menu">
            {/* A bundle that carries its drafted products links them; the rest still say why not. */}
            {(['sitrep', 'IAP'] as const).map((name) => {
              const url = incident?.files[name.toLowerCase()];
              return url ? (
                <a key={name} role="menuitem" href={url} target="_blank" rel="noreferrer">
                  {name.toUpperCase()}<small>Draft, unapproved · opens to print</small>
                </a>
              ) : (
                <button key={name} type="button" role="menuitem" disabled>
                  {name.toUpperCase()}<small>Generator not connected to this console yet</small>
                </button>
              );
            })}
          </div>
        </details>
      </header>

      {tabId === 'detection' && detectionPanel === 'scene' ? (
        <SceneView slick={slick} incident={incident} incidentId={incidentId} />
      ) : tabId === 'detection' && detectionPanel === 'map' ? (
        <MapPage slick={slick} incident={incident} incidentId={incidentId} />
      ) : tabId === 'detection' && detectionPanel === 'provenance' ? (
        <ProvenancePage slick={slick} incident={incident} incidentId={incidentId} />
      ) : (
      <div className={`ws-split ${tabId === 'detection' ? 'ws-split-flat' : ''} ${tabId === 'temporal' ? 'ws-split-detection ws-split-forecast' : ''} ${tabId === 'response' ? 'ws-split-detection ws-split-response' : ''}`}>
        {tabId === 'temporal' && (
          <aside className="ws-detection-nav" aria-label="Forecast and impact views">
            {FORECAST_PANELS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={forecastPanel === id ? 'page' : undefined}
                onClick={() => setForecastPanel(id)}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
              </button>
            ))}
          </aside>
        )}
        {tabId === 'response' && (
          <aside className="ws-detection-nav" aria-label="Response views">
            {RESPONSE_PANELS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-current={responsePanel === id ? 'page' : undefined} onClick={() => setResponsePanel(id)}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
              </button>
            ))}
          </aside>
        )}
        {/* The map, edge to edge. The slick is its default child, so a stage
          * with no chart of its own still shows the thing being investigated. */}
        {/* Two rows, like Spills: the chart, and under it the dock a stage's
          * timeline bar portals into. A bar in a row stretches the width of the
          * map and pushes it up; nothing floats over the chart to hold clear of. */}
        <div className="ws-map">
          <div className="ws-map-view">
          {/* The charts live in a host of their own so the step chips below
            * are not siblings of theirs — "the last chart wins" is a selector,
            * and a chip counted as a chart broke it once already. */}
          <div className="ws-charts" ref={setMapHost}>
            {!hasChart && <SlickChart slick={slick} />}
          </div>

          {/* The tab's own steps, on the chart rather than in the rail: they
            * change what is drawn, and they sit where the caption chip used
            * to. One step means nothing to choose, so nothing is drawn. */}
          {inTab.length > 1 && (
            <div className="imap-steps">
              {inTab.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="imap-chip imap-step"
                  aria-current={item.id === stage.id ? 'step' : undefined}
                  title={item.asks}
                  onClick={() => setStageId(item.id)}
                >
                  {item.label}
                  <span className={`ws-stage-state is-${STATE_STATUS(stageState(item, incident))}`}>
                    {STATE_LABEL(stageState(item, incident))}
                  </span>
                </button>
              ))}
            </div>
          )}
          </div>
          <div className="ws-dock" ref={setDockHost} />
        </div>

        {/* Native drag, no library: pointer capture and one clamped number. */}
        <div
          className="ws-grip"
          role="separator"
          aria-label="Resize the panel"
          aria-orientation="vertical"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            grab.current = { x: event.clientX, width: railWidth };
          }}
          onPointerMove={(event) => {
            if (!grab.current) return;
            const next = grab.current.width + (grab.current.x - event.clientX);
            setRailWidth(Math.max(260, Math.min(720, next)));
          }}
          onPointerUp={() => {
            grab.current = undefined;
          }}
        />

        <aside className="ws-rail" aria-label="Stages and detail">
          <div className="ws-rail-body">
            {/* The clocked run costs real CPU, so it starts when Forecast is on
                screen — not when a record is opened. */}
            <ForecastProvider
              slick={slick}
              incident={incident}
              incidentId={incidentId}
              enabled={tabId === 'temporal' && stage.id === 'forecast' && !(forecastPanel === 'overview' && forecastDirection === 'backward')}
              horizonEnabled={tabId === 'temporal' && stage.id === 'forecast' && !(forecastPanel === 'overview' && forecastDirection === 'backward')}
            >
              <StageHosts value={{ map: mapHost, dock: dockHost, slick, setHasChart }}>
                <Body slick={slick} incident={incident} incidentId={incidentId} detectionPanel={detectionPanel === 'map' ? 'vessels' : detectionPanel} forecastPanel={forecastPanel} forecastDirection={forecastDirection} setForecastDirection={setForecastDirection} responsePanel={responsePanel} setResponsePanel={setResponsePanel} />
              </StageHosts>
            </ForecastProvider>

          </div>
        </aside>
      </div>
      )}
    </div>
  );
}
