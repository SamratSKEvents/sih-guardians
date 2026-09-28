import { useEffect, useMemo, useState } from 'react';
import { Activity, Anchor, ArrowDownRight, Clock3, Compass, Droplets, Info, MapPinned, Ship, Wind } from 'lucide-react';
import { Badge, Field, FieldList, Notice } from '../../../design/components';
import { useForecast } from '../../../forecast/context';
import type { ForecastDirection, StageProps } from '../Workspace';
import { Dock, StageFrame } from '../StageFrame';
import { ForecastClock, RunProgress } from '../ForecastClock';
import { ForecastMap } from '../ForecastMap';
import { fetchSourceHypotheses } from '../../../api/incidents';
import { useArtifact } from '../../../incidents/useArtifact';
import type { SourceHypotheses } from '../../../incidents/types';
import { agesForScenario, selectBacktrackHypotheses } from '../../../forecast/backtrack';
import '../forecast.css';

import { token } from '../../../design/token';
const mockVessels = [
  { name: 'Med Star', kind: 'Tanker', imo: '9234567', distance: '0.8 km', speed: '3.2 kn', course: '126° SE', color: token('--orange-200-k') },
  { name: 'Northwind', kind: 'Cargo', imo: '9412073', distance: '4.6 km', speed: '11.8 kn', course: '304° NW', color: token('--green-200-d') },
  { name: 'Asterion', kind: 'Tanker', imo: '9701142', distance: '7.2 km', speed: '6.4 kn', course: '082° E', color: token('--rose-300-d') },
];

function BacktrackClock({ hours, setHours, min, max, dataBacked }: { hours: number; setHours: (hours: number) => void; min: number; max: number; dataBacked: boolean }) {
  return <div className="backtrack-clock"><div><Clock3 size={15} /><b>T−{hours.toFixed(0)} h</b><span>from image capture · {dataBacked ? 'hindcast window' : 'illustrative corridor'}</span></div><input aria-label="Backtrack horizon" type="range" min={min} max={max} step="1" value={hours} onChange={(event) => setHours(Number(event.target.value))} /><small>T−{min} h <span>T−{max} h</span></small></div>;
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Wind; label: string; value: string; tone?: string }) {
  return <div className="forecast-metric"><span className={`forecast-metric-icon ${tone ?? ''}`}><Icon size={16} /></span><span>{label}</span><strong>{value}</strong></div>;
}

export function ForecastStage({ slick, incidentId, forecastPanel, forecastDirection, setForecastDirection }: StageProps) {
  const [backtrackHours, setBacktrackHours] = useState(12);
  const [backtrackScenario, setBacktrackScenario] = useState('');
  const sourceArtifact = useArtifact<SourceHypotheses>(incidentId, fetchSourceHypotheses);
  const { run, horizon, forcing, hoursIn, frame, areaM2, volumeM3 } = useForecast();
  const sourceData = sourceArtifact && sourceArtifact !== 'error' && sourceArtifact.status === 'AVAILABLE'
    ? sourceArtifact
    : undefined;
  const scenarioOptions = useMemo(
    () => sourceData?.scenarios ?? [...new Set(sourceData?.hypotheses?.map((item) => item.scenario) ?? [])],
    [sourceData],
  );
  const selectedScenario = scenarioOptions.includes(backtrackScenario) ? backtrackScenario : scenarioOptions[0] ?? '';
  const scenarioAges = useMemo(
    () => agesForScenario(sourceData?.hypotheses, selectedScenario),
    [sourceData, selectedScenario],
  );
  const backtrackMin = scenarioAges[0] ?? 1;
  const backtrackMax = scenarioAges.at(-1) ?? 48;
  const backtrackTrack = useMemo(
    () => selectBacktrackHypotheses(sourceData?.hypotheses, selectedScenario, backtrackMax),
    [sourceData, selectedScenario, backtrackMax],
  );
  const backtrackHypotheses = useMemo(
    () => selectBacktrackHypotheses(sourceData?.hypotheses, selectedScenario, backtrackHours),
    [sourceData, selectedScenario, backtrackHours],
  );
  const hasBacktrackData = backtrackTrack.length > 0;
  useEffect(() => {
    setBacktrackHours((hours) => Math.min(backtrackMax, Math.max(backtrackMin, hours)));
  }, [backtrackMin, backtrackMax]);
  const visualFrame = frame ?? horizon.frame;
  const atHours = frame?.hour ?? 0;
  const shorelineRisk = atHours > 8 ? 'Elevated' : atHours > 4 ? 'Moderate' : 'Low';
  const impactProgress = Math.max(0, Math.min(1, hoursIn / 24));
  const cleanupLow = Math.round(180 + 720 * impactProgress);
  const cleanupHigh = Math.round(cleanupLow * 1.8);
  const wildlifeLow = Math.round(40 + 360 * impactProgress);
  const wildlifeHigh = Math.round(wildlifeLow * 1.75);
  const mapView = forecastPanel === 'overview' && forecastDirection === 'backward' ? 'backward' : forecastPanel;

  const chart = (
    <>
      <ForecastMap
        slick={slick}
        frame={mapView === 'backward' ? undefined : visualFrame}
        view={mapView}
        windSpeed={forcing.windSpeed}
        windDir={forcing.windDirDeg}
        current={[forcing.driftU, forcing.driftV]}
        backtrackHours={backtrackHours}
        backtrackTrack={backtrackTrack}
        backtrackHypotheses={backtrackHypotheses}
      />
      <div className="forecast-map-heading">
        <span className="forecast-live-dot" />
        <span>{forecastPanel === 'impact' ? 'SHORELINE EXPOSURE' : forecastPanel === 'vessels' ? 'AIS TRACK CONTEXT' : forecastPanel === 'environment' ? 'ENVIRONMENTAL FORCING' : forecastDirection === 'backward' ? 'SOURCE BACKTRACK' : 'FORWARD DRIFT SIMULATION'}</span>
        <span className="forecast-map-time">{mapView === 'backward' ? hasBacktrackData ? `T−${backtrackHypotheses[0]?.ageHours ?? backtrackMin} h support` : `−${backtrackHours} h estimate` : visualFrame ? `+${visualFrame.hour.toFixed(1)} h` : 'Starting model'}</span>
      </div>
      <div className="forecast-map-legend">
        <span><i className="forecast-legend-oil" /> Oil thickness</span>
        {forecastPanel === 'environment' && <><span><i className="forecast-legend-wind" /> Wind</span><span><i className="forecast-legend-current" /> Surface current</span></>}
        {forecastPanel === 'impact' && <><span><i className="forecast-legend-high" /> High exposure</span><span><i className="forecast-legend-watch" /> Watch</span></>}
        {forecastPanel === 'vessels' && <span><i className="forecast-legend-vessel" /> AIS at image capture</span>}
      </div>
    </>
  );

  return (
    <StageFrame chart={chart}>
      <Dock>{mapView === 'backward' ? <BacktrackClock hours={backtrackHours} setHours={setBacktrackHours} min={backtrackMin} max={backtrackMax} dataBacked={hasBacktrackData} /> : <ForecastClock />}</Dock>
      <div className="forecast-stage">
        <div className="forecast-kicker"><Activity size={14} /> {forecastPanel === 'overview' ? 'FORECAST SUMMARY' : forecastPanel === 'environment' ? 'ENVIRONMENTAL CONDITIONS' : forecastPanel === 'impact' ? 'COASTAL EXPOSURE' : 'VESSEL CONTEXT'}</div>
        <h2>{forecastPanel === 'overview' ? 'Forecast overview' : forecastPanel === 'environment' ? 'Environmental data' : forecastPanel === 'impact' ? 'Shoreline impact' : 'Vessel context'}</h2>

        {mapView === 'backward' && hasBacktrackData && (
          <Notice status="watch" title="Lagrangian source hindcast · bundled data">
            {sourceData?.warnings?.join(' ') ?? 'Particle support regions are reconstructed hypotheses, not confirmed release locations.'}
          </Notice>
        )}
        {mapView === 'backward' && !hasBacktrackData && (
          <Notice status="warning" title="Demo backtrack estimate">
            This record has no bundled hindcast. The mean-forcing corridor is illustrative and is not a separately validated inverse simulation.
          </Notice>
        )}
        {mapView !== 'backward' && !forcing.measured && (
          <Notice status="warning" title="Demo simulation · synthetic forcing">
            Wind, currents and eddies are generated by the oil-imp model. Treat the mapped drift and impact markers as a prototype scenario, not an operational forecast.
          </Notice>
        )}
        {mapView !== 'backward' && forcing.measured && <Notice status="watch" title="Modelled scenario · simplified forcing">Measured wind and current seed the run; local eddies and coastal impact markers remain illustrative.</Notice>}
        {mapView !== 'backward' && run.failed && <Notice status="warning" title="Simulation could not run">{run.failed}</Notice>}

        <RunProgress />

        {forecastPanel === 'overview' && (
          <>
            <div className="forecast-direction" role="group" aria-label="Forecast direction">
              {(['forward', 'backward'] as ForecastDirection[]).map((direction) => (
                <button key={direction} type="button" aria-pressed={forecastDirection === direction} onClick={() => setForecastDirection(direction)}>
                  {direction === 'forward' ? 'Forward forecast' : 'Backward source'}
                </button>
              ))}
            </div>
            {forecastDirection === 'backward' && (
              <>
                {hasBacktrackData ? (
                  <>
                    <div className="backtrack-scenarios" role="group" aria-label="Backward windage case">
                      <span>Windage case <small>separate reconstructed scenarios</small></span>
                      <div>{scenarioOptions.map((scenario) => {
                        const label = scenario.replace('windage_', '');
                        return <button key={scenario} type="button" aria-pressed={selectedScenario === scenario} onClick={() => setBacktrackScenario(scenario)}>{label}</button>;
                      })}</div>
                    </div>
                    <div className="forecast-inline-note backtrack-note"><Info size={15} /> Bundled Lagrangian hindcast · 256 particles at each checkpoint. Shaded regions show ensemble spread, not a calibrated probability or confirmed release point.</div>
                  </>
                ) : (
                  <div className="forecast-inline-note backtrack-note"><Info size={15} /> No bundled hindcast for this record. The displayed corridor is a demo estimate from mean forcing, not a separately validated inverse simulation.</div>
                )}
              </>
            )}
            <div className="forecast-metrics">
              <Metric icon={Droplets} label="Detected area" value={`${(areaM2 / 1e6).toFixed(2)} km²`} tone="oil" />
              <Metric icon={Clock3} label={forecastDirection === 'backward' ? 'Backtrack window' : 'Run position'} value={forecastDirection === 'backward' ? `−${backtrackHours} h` : `+${hoursIn.toFixed(1)} h`} tone="time" />
              <Metric icon={MapPinned} label="Shoreline exposure" value={shorelineRisk} tone="risk" />
            </div>
            {forecastDirection === 'forward' && <section className="forecast-section">
              <h3><Activity size={16} /> Modelled oil budget</h3>
              <FieldList>
                <Field label="Oil volume" value={`${volumeM3.toFixed(1)} m³`} note="Assumed 50 µm mean thickness; SAR detects area, not volume." />
                <Field label="Still afloat" value={`${(visualFrame?.budget.afloat ?? volumeM3).toFixed(1)} m³`} />
                <Field label="Evaporated" value={`${(visualFrame?.budget.evaporated ?? 0).toFixed(1)} m³`} />
                <Field label="Naturally dispersed" value={`${(visualFrame?.budget.dispersed ?? 0).toFixed(1)} m³`} />
              </FieldList>
            </section>}
            <section className="forecast-section">
              <h3><Compass size={16} /> Key times</h3>
              <div className="forecast-time-list">
                <span><b>Image captured</b><small>Observed slick outline</small></span><strong>+00 h</strong>
                {forecastDirection === 'backward' ? (
                  <>
                    <span><b>{hasBacktrackData ? 'Latest hindcast point' : 'Backtrack estimate'}</b><small>{hasBacktrackData ? 'Nearest available checkpoint' : 'Illustrative mean-forcing corridor'}</small></span><strong>−{hasBacktrackData ? backtrackHypotheses.at(-1)?.ageHours ?? backtrackHours : backtrackHours} h</strong>
                    <span><b>{hasBacktrackData ? 'Oldest visible source support' : 'Demo source area'}</b><small>{hasBacktrackData ? 'Support region · not a release point' : 'Not verified or calibrated'}</small></span><strong>−{backtrackHypotheses[0]?.ageHours ?? backtrackHours} h</strong>
                  </>
                ) : (
                  <>
                    <span><b>Initial drift</b><small>First projected movement</small></span><strong>+06 h</strong>
                    <span><b>Scenario horizon</b><small>Modelled to current horizon</small></span><strong>+24 h</strong>
                  </>
                )}
              </div>
            </section>
          </>
        )}

        {forecastPanel === 'environment' && (
          <>
            <p className="forecast-intro">Conditions applied to the current simulation. Wind direction indicates where the wind is blowing toward.</p>
            <section className="forecast-section">
              <h3><Wind size={16} /> Wind & current</h3>
              <FieldList>
                <Field label="Wind speed" value={`${forcing.windSpeed.toFixed(1)} m/s`} />
                <Field label="Wind toward" value={`${Math.round(forcing.windDirDeg)}°`} />
                <Field label="Surface current · east" value={`${forcing.driftU.toFixed(2)} m/s`} />
                <Field label="Surface current · north" value={`${forcing.driftV.toFixed(2)} m/s`} />
                <Field label="Data source" value={forcing.measured ? 'Incident bundle' : 'Synthetic scenario'} numeric={false} />
              </FieldList>
            </section>
            <div className="forecast-inline-note"><Info size={15} /> Map arrows show the run's mean wind and current. Fine-scale eddies are generated by the solver.</div>
          </>
        )}

        {forecastPanel === 'impact' && (
          <>
            <div className="forecast-impact-score"><span className="forecast-risk-orb"><ArrowDownRight size={21} /></span><span><small>SCENARIO EXPOSURE · +{hoursIn.toFixed(1)} H</small><strong>{shorelineRisk}</strong></span><Badge status={shorelineRisk === 'Elevated' ? 'warning' : 'watch'}>Demo estimate</Badge></div>
            <section className="forecast-loss-panel">
              <span className="loss-title"><Activity size={16} /> Indicative loss predictor <small>mock scenario</small></span>
              <div className="loss-primary"><small>Potential response & cleanup cost</small><strong>${cleanupLow.toLocaleString()}k–${cleanupHigh.toLocaleString()}k</strong></div>
              <div className="loss-secondary"><span><b>{wildlifeLow}–{wildlifeHigh}</b><small>wildlife potentially exposed</small></span><span><b>{(4 + 16 * impactProgress).toFixed(0)}–{(9 + 31 * impactProgress).toFixed(0)} km²</b><small>sensitive habitat at risk</small></span></div>
              <div className="loss-sparkline" aria-label={`Indicative loss increases with the forecast horizon, currently ${Math.round(impactProgress * 100)} percent`}><i style={{ transform: `scaleX(${Math.max(0.08, impactProgress)})` }} /></div>
              <small className="loss-footnote">Scenario ranges only. Costs and wildlife counts are synthetic planning placeholders, not a valuation of actual losses.</small>
            </section>
            <section className="forecast-section">
              <h3><MapPinned size={16} /> Potentially exposed receptors</h3>
              <div className="forecast-receptor"><span className="receptor-dot high" /><span><b>Coastal habitat</b><small>Priority habitat · 8.4 km</small></span><strong>High</strong></div>
              <div className="forecast-receptor"><span className="receptor-dot medium" /><span><b>Shellfish beds</b><small>Fisheries area · 14.1 km</small></span><strong>Moderate</strong></div>
              <div className="forecast-receptor"><span className="receptor-dot low" /><span><b>Protected shoreline</b><small>Conservation zone · 21.6 km</small></span><strong>Watch</strong></div>
            </section>
            <section className="forecast-section">
              <h3><Anchor size={16} /> Modelled shoreline contact</h3>
              <FieldList>
                <Field label="Estimated arrival" value={hoursIn > 8 ? '+8–16 h' : '+18–24 h'} />
                <Field label="Coastline segment" value="North inlet · demo" numeric={false} />
                <Field label="Confidence" value="Low · synthetic forcing" numeric={false} />
              </FieldList>
            </section>
            <p className="forecast-disclaimer">Impact overlays are mock data for this prototype. No live receptors or shoreline contact assessment is connected.</p>
          </>
        )}

        {forecastPanel === 'vessels' && (
          <>
            <div className="forecast-vessel-summary"><Ship size={17} /><span><b>3 vessels in context</b><small>Track positions are shown at the time of image capture.</small></span></div>
            <section className="forecast-section">
              <h3><Compass size={16} /> Nearby AIS tracks</h3>
              {mockVessels.map((vessel) => (
                <div className="forecast-vessel" key={vessel.imo}>
                  <span className="vessel-color" style={{ background: vessel.color }} />
                  <span><b>{vessel.name}</b><small>{vessel.kind} · IMO {vessel.imo}</small></span>
                  <strong>{vessel.distance}</strong>
                  <small className="vessel-course">{vessel.speed} · {vessel.course}</small>
                </div>
              ))}
            </section>
            <div className="forecast-inline-note"><Info size={15} /> Dashed lines show simplified recent AIS routes; the colored dots mark reported positions at image capture.</div>
          </>
        )}
      </div>
    </StageFrame>
  );
}
