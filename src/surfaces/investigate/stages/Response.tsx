import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Activity, AlertTriangle, Anchor, Bell, Check, CheckCircle2, ChevronRight, Clock3, FileText, FlaskConical, MapPinned, Plane, Play, RotateCcw, Ship, Shield, Sparkles, Waves } from 'lucide-react';
import { Badge, Field, FieldList } from '../../../design/components';
import type { ResponsePanel, StageProps } from '../Workspace';
import { Dock, StageFrame } from '../StageFrame';
import { ResponseMap } from '../ResponseMap';
import '../response.css';

const ALERTS = [
  { title: 'Shoreline impact risk', severity: 'High', time: '05:12 UTC', zone: 'Northern coastline · 18 km', action: 'Increase shoreline protection and deploy assets.' },
  { title: 'Sensitive habitat at risk', severity: 'Medium', time: '06:48 UTC', zone: 'Marine protected area', action: 'Prioritise containment toward habitat.' },
  { title: 'Response window closing', severity: 'High', time: '06:20 UTC', zone: 'Offshore · 0.96 km²', action: 'Deploy containment assets within 12 hours.' },
];

const RESPONSE_ASSETS = [
  { name: 'Containment Boom A', type: 'Containment boom', vessel: 'MV Coast Guard', location: '36.72° N, 33.18° E', speed: '0.8 kn', task: 'Containment deployment', crew: '8', status: 'On scene', eta: '—' },
  { name: 'Skimmer 01', type: 'Skimming vessel', vessel: 'MV Recovery', location: '36.68° N, 33.12° E', speed: '8.4 kn', task: 'Surface recovery', crew: '6', status: 'En route', eta: '2.1 h' },
  { name: 'Response Vessel 1', type: 'Support vessel', vessel: 'MV Guardian', location: '36.81° N, 33.10° E', speed: '0 kn', task: 'Standby', crew: '12', status: 'Standby', eta: '4.5 h' },
  { name: 'Supply Vessel 1', type: 'Supply vessel', vessel: 'MV Supply', location: '36.61° N, 33.27° E', speed: '—', task: 'Mechanical issue', crew: '5', status: 'Unavailable', eta: 'Unknown' },
];

const STATIONS = [
  { id: 'S-1', place: 'Impact zone', type: 'Water', priority: 'High', color: 'high' },
  { id: 'S-2', place: 'Coastal', type: 'Water + shoreline', priority: 'High', color: 'high' },
  { id: 'S-3', place: 'Near boundary', type: 'Water', priority: 'Medium', color: 'medium' },
  { id: 'S-4', place: 'Down-current', type: 'Water', priority: 'Medium', color: 'medium' },
  { id: 'B-1', place: 'Background', type: 'Water', priority: 'Reference', color: 'reference' },
];

function Section({ title, icon: Icon, action, children }: { title: string; icon: typeof Activity; action?: string; children: React.ReactNode }) {
  return <section className="response-section"><h3><Icon size={16} /><span>{title}</span>{action && <button type="button" className="response-link">{action}<ChevronRight size={14} /></button>}</h3>{children}</section>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="response-stat"><small>{label}</small><b className={tone}>{value}</b></div>;
}

function DotStatus({ label, status }: { label: string; status: string }) {
  const tone = status === 'Unavailable' ? 'red' : status === 'En route' ? 'blue' : status === 'Standby' ? 'slate' : 'green';
  return <span className={`response-status ${tone}`}><i />{label}</span>;
}

function IncidentClock({ hour, setHour }: { hour: number; setHour: Dispatch<SetStateAction<number>> }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setHour((current) => current >= 24 ? 6 : current + (speed * 0.08)), 120);
    return () => window.clearInterval(timer);
  }, [playing, speed, setHour]);
  const at = new Date(Date.UTC(2025, 0, 29, Math.floor(hour), Math.round((hour % 1) * 60)));
  const timeLabel = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
  return (
    <div className="response-clock">
      <div className="response-clock-top">
        <button type="button" aria-label="Go to start" onClick={() => setHour(6)}><RotateCcw size={15} /></button>
        <button type="button" className="response-play" aria-label={playing ? 'Pause timeline' : 'Play timeline'} onClick={() => setPlaying((value) => !value)}><Play size={15} fill="currentColor" /></button>
        <button type="button" aria-label="Step forward" onClick={() => setHour((value) => Math.min(24, value + 1))}><ChevronRight size={16} /></button>
        <strong>{timeLabel}</strong><span>UTC</span><small>{at.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</small>
        <div className="response-speeds">{[0.5, 1, 2, 5, 10].map((value) => <button type="button" key={value} aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}×</button>)}</div>
        <button type="button" className="response-live" onClick={() => { setHour(7.57); setPlaying(false); }}><i /> Live</button>
      </div>
      <div className="response-clock-range"><span>29 Jan<br /><small>06:00</small></span><input aria-label="Response timeline" type="range" min="6" max="24" step="0.05" value={hour} onChange={(event) => setHour(Number(event.target.value))} /><span>30 Jan<br /><small>00:00</small></span></div>
      <div className="response-tick-row"><span>06:00</span><span>09:00</span><span>12:00</span><span>15:00</span><span>18:00</span><span>21:00</span></div>
    </div>
  );
}

export function ResponseStage({ slick, responsePanel }: StageProps) {
  const [hour, setHour] = useState(7.57);
  const [deployed, setDeployed] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const activeCount = ALERTS.filter((alert) => !acknowledged.includes(alert.title)).length;
  const stageLabel = useMemo(() => ({
    overview: 'Response overview', containment: 'Containment plan', assets: 'Response assets', surveillance: 'Surveillance missions',
    cleanup: 'Cleanup priorities', sampling: 'Sampling plan', alerts: 'Operational alerts',
  } satisfies Record<ResponsePanel, string>)[responsePanel], [responsePanel]);
  const notification = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600); };

  const map = <>
    <ResponseMap slick={slick} panel={responsePanel} hour={hour} />
    <div className="response-map-callout"><span className="response-map-dot" /> LIVE RESPONSE SCENARIO <b>{hour.toFixed(1)} H</b></div>
  </>;

  return (
    <StageFrame chart={map}>
      <Dock><IncidentClock hour={hour} setHour={setHour} /></Dock>
      <div className="response-pane">
        <div className="response-pane-title"><span className="response-kicker"><Activity size={13} /> DEMO INCIDENT · COASTAL RESPONSE</span><h2>{stageLabel}</h2><p>Coordinated action for a faster, safer, cleaner response.</p></div>

        {responsePanel === 'overview' && <>
          <Section title="Operational status" icon={CheckCircle2}>
            <div className="response-status-line"><span><i />Active response</span><span>All mock systems operational</span><small>Last updated<br /><b>{`${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')} UTC`}</b></small></div>
          </Section>
          <Section title="Active alerts" icon={Bell} action={`View all (${activeCount})`}>
            {ALERTS.slice(0, 2).map((alert, index) => <button className="response-alert-row" type="button" key={alert.title} onClick={() => setAcknowledged((list) => list.includes(alert.title) ? list : [...list, alert.title])}><i className={index ? 'amber' : 'red'} /><span><b>{alert.title}</b><small>{alert.zone}</small></span><small>{index + 2} h ago</small></button>)}
          </Section>
          <Section title="Containment summary" icon={Shield}><div className="response-stats"><Stat label="Deployments" value={deployed ? '2' : '1'} /><Stat label="Total length" value={deployed ? '3.6 km' : '2.4 km'} /><Stat label="Status" value={deployed ? 'In progress' : 'Planning'} tone="green" /></div></Section>
          <Section title="Asset summary" icon={Ship}><div className="response-stats"><Stat label="Total assets" value="4" /><Stat label="On scene" value="2" /><Stat label="En route" value="1" /><Stat label="Standby" value="1" /></div></Section>
          <Section title="Surveillance summary" icon={Plane}><div className="response-stats"><Stat label="Active missions" value="1" /><Stat label="Area" value="156 km²" /><Stat label="Last flight" value="06:12 UTC" /></div></Section>
          <Section title="Cleanup summary" icon={Waves}><div className="response-stats"><Stat label="Priority areas" value="3" /><Stat label="Shoreline length" value="18.2 km" /><Stat label="Status" value="Planning" tone="blue" /></div></Section>
          <Section title="Sampling summary" icon={FlaskConical}><div className="response-stats"><Stat label="Stations" value="5" /><Stat label="Samples collected" value="0" /><Stat label="Status" value="Planned" tone="blue" /></div></Section>
          <div className="response-quick-actions"><h3><Sparkles size={15} /> Quick actions</h3><div><button type="button" onClick={() => notification('Draft incident action plan created.') }><FileText size={14} /> Generate IAP</button><button type="button" onClick={() => notification('SITREP draft prepared.') }><FileText size={14} /> Create SITREP</button><button type="button" onClick={() => notification('Technical report draft prepared.') }><Activity size={14} /> Technical report</button></div></div>
        </>}

        {responsePanel === 'containment' && <>
          <Section title="Recommended interception zone" icon={CheckCircle2}>
            <div className="response-recommendation"><span className="response-check"><Check size={18} /></span><div><small>RECOMMENDED BOOM POSITION</small><b>Candidate Boom A</b></div><Badge status="clear">Recommended</Badge></div>
            <div className="response-stats"><Stat label="Position (centre)" value="37.24° N, 18.91° E" /><Stat label="Estimated length" value="1.8 km" /><Stat label="Priority" value="High" tone="green" /></div>
          </Section>
          <Section title="Boom deployment summary" icon={Anchor}><div className="response-stats"><Stat label="Total boom length" value={deployed ? '3.6 km' : '1.8 km'} /><Stat label="Boom type" value="Offshore, inflatable" /><Stat label="Vessels required" value="2" /></div></Section>
          <Section title="Interception window" icon={Clock3}><div className="response-stats"><Stat label="Earliest deployment" value="Now" /><Stat label="Optimal window" value="1–4 hours" /><Stat label="Effectiveness" value="High" tone="green" /></div></Section>
          <Section title="Feasibility & safety" icon={Shield}><FieldList><Field label="Technical feasibility" value="High" /><Field label="Sea state" value="0.6 m" /><Field label="Wind" value="8 kt · NW" /></FieldList></Section>
          <Section title="Environmental conditions" icon={Waves}><div className="response-stats"><Stat label="Current" value="0.4 kt · E" /><Stat label="Wave height" value="0.6 m" /><Stat label="Wind speed" value="8 kt · NW" /></div></Section>
          <Section title="Rationale" icon={FileText}><p className="response-copy">Boom A intercepts the modelled slick before it reaches the priority shoreline segment. This is a prototype recommendation; confirm conditions and asset readiness before action.</p></Section>
          <button className={`response-primary-action ${deployed ? 'done' : ''}`} type="button" onClick={() => { setDeployed(true); notification(deployed ? 'Containment plan is already assigned.' : 'Containment plan assigned to the demo asset.'); }}><Anchor size={15} />{deployed ? 'Assigned to response team' : 'Assign containment plan'}</button>
        </>}

        {responsePanel === 'assets' && <>
          <Section title="Asset inventory summary" icon={Ship}><div className="response-stats response-stats-5"><Stat label="Total assets" value="12" /><Stat label="On scene" value="4" /><Stat label="En route" value="3" /><Stat label="Standby" value="4" /><Stat label="Unavailable" value="1" /></div></Section>
          <Section title="Selected asset" icon={Anchor} action="Details"><div className="response-selected"><div><small>SELECTED RESPONSE ASSET</small><h4>Containment Boom A</h4><DotStatus label={deployed ? 'Deployed' : 'On scene'} status={deployed ? 'En route' : 'On scene'} /></div></div><FieldList><Field label="Type" value={RESPONSE_ASSETS[0].type} numeric={false} /><Field label="Vessel" value={RESPONSE_ASSETS[0].vessel} numeric={false} /><Field label="Location" value={RESPONSE_ASSETS[0].location} numeric={false} /><Field label="Speed" value={RESPONSE_ASSETS[0].speed} /><Field label="Task" value={RESPONSE_ASSETS[0].task} numeric={false} /><Field label="Crew" value={RESPONSE_ASSETS[0].crew} /></FieldList></Section>
          <Section title="Pre-position recommendation" icon={MapPinned}><p className="response-copy">Position Skimmer 02 at Staging Point South to intercept the forecast slick.</p><div className="response-stats"><Stat label="ETA" value="2.4 h" /><Stat label="Distance" value="18 km" /><button type="button" className="response-small-action" onClick={() => notification('Skimmer 02 assignment added to the draft plan.')}>Assign <ChevronRight size={13} /></button></div></Section>
          <Section title="Readiness and ETA" icon={Clock3}>{RESPONSE_ASSETS.map((asset) => <div className="response-readiness" key={asset.name}><span>{asset.name}</span><DotStatus label={asset.status} status={asset.status} /><b>{asset.eta}</b></div>)}</Section>
          <Section title="Conflicts and constraints" icon={AlertTriangle}><p className="response-copy"><b>Supply Vessel 1 unavailable</b><br />Mechanical issue · ETA unknown</p></Section>
        </>}

        {responsePanel === 'surveillance' && <>
          <Section title="Active mission" icon={Plane}>
            <div className="response-recommendation"><span className="response-icon mission"><Plane size={16} /></span><div><b>Surveillance mission S-1</b><small>Edge verification</small></div><Badge status="clear">In progress</Badge></div>
            <FieldList><Field label="Mission ID" value="SURV-001" /><Field label="Platform" value="Fixed-wing (P-3)" numeric={false} /><Field label="Start time" value="29 Jan 2025, 06:50 UTC" numeric={false} /><Field label="Estimated end" value="29 Jan 2025, 09:30 UTC" numeric={false} /></FieldList>
          </Section>
          <Section title="Evidence gap" icon={AlertTriangle}><p className="response-copy">Limited observations on the eastern slick edge. Recommended: aerial pass to verify extent.</p><Badge status="warning">High priority</Badge></Section>
          <Section title="Observation window" icon={Clock3}><div className="response-recommendation"><span className="response-icon mission"><Clock3 size={16} /></span><div><b>Optimal now</b><small>Good visibility · low cloud cover</small></div><Badge status="clear">Open</Badge></div><p className="response-copy">29 Jan 2025, 06:00–12:00 UTC</p></Section>
          <Section title="Platform assignment" icon={Ship}><div className="response-stats"><Stat label="Aircraft" value="P-3 Orion" /><Stat label="Call sign" value="GUARD-01" /><Stat label="Endurance" value="~4 h" /></div></Section>
          <Section title="Mission objective" icon={MapPinned}><p className="response-copy">Verify slick extent and monitor movement toward the coastline. Assess potential shoreline impact areas.</p></Section>
          <Section title="Expected information gain" icon={Activity}><p className="response-copy">Refined slick boundaries (±25%), improved drift forecast, earlier detection of shoreline contact.</p></Section>
          <Section title="Mission queue" icon={Clock3}>{['SURV-002 · Shoreline assessment', 'SURV-003 · Wide area monitoring'].map((item, index) => <div className="response-queue-row" key={item}><span>{index + 2}</span><b>{item.split(' · ')[0]}</b><small>{item.split(' · ')[1]}</small><Badge status="watch">Planned</Badge></div>)}</Section>
        </>}

        {responsePanel === 'cleanup' && <>
          <Section title="Top priority areas" icon={Waves}><div className="response-clean-zone"><i className="red" /><b>Zone B · Sandy Beach</b><small>18 km</small><strong>Immediate</strong></div><div className="response-clean-zone"><i className="red" /><b>Zone A · Rocks / Cliffs</b><small>12 km</small><strong>High</strong></div><div className="response-clean-zone"><i className="amber" /><b>Zone C · Mixed Shoreline</b><small>9 km</small><strong>High</strong></div><button className="response-link standalone" type="button">View all shoreline segments <ChevronRight size={14} /></button></Section>
          <Section title="Impacted shoreline length" icon={MapPinned}><div className="response-stats"><Stat label="Total at risk" value="39 km" /><Stat label="High priority" value="30 km" /><Stat label="Moderate priority" value="9 km" /></div></Section>
          <Section title="Access & safety notes" icon={AlertTriangle}><ul className="response-bullet-notes"><li>Rough surf and rock terrain at Zone A.</li><li>Sensitive habitat near Zone B; low-impact methods.</li><li>Access via coastal road is open to Zone C.</li></ul></Section>
          <Section title="Resource needs" icon={Ship}><div className="response-stats"><Stat label="Personnel" value="48" /><Stat label="Vessels" value="6" /><Stat label="Shoreline equipment" value="12 sets" /></div></Section>
          <Section title="Urgency" icon={Clock3}><div className="response-urgency"><Badge status="warning">High</Badge><b>Immediate action required</b><small>Optimal cleanup window: 0–72 hours</small></div></Section>
          <Section title="Planning status" icon={CheckCircle2}><div className="response-stats"><Stat label="Cleanup plan" value="Drafting" tone="blue" /><Stat label="Teams mobilized" value="Yes" tone="green" /><Stat label="Estimated start" value="10:00 UTC" /></div></Section>
          <div className="response-quick-actions"><h3><Activity size={15} /> Quick actions</h3><div><button type="button" onClick={() => notification('Draft cleanup plan generated.')}>Generate cleanup plan</button><button type="button" onClick={() => notification('SITREP draft prepared.')}>Create SITREP</button><button type="button" onClick={() => notification('Technical report draft prepared.')}>Technical report</button></div></div>
        </>}

        {responsePanel === 'sampling' && <>
          <Section title="Sampling objectives" icon={CheckCircle2}><ul className="response-checklist">{['Confirm slick boundary and extent', 'Assess hydrocarbon concentrations (water)', 'Monitor nearshore sensitive areas', 'Establish background conditions'].map((item) => <li key={item}><CheckCircle2 size={15} />{item}</li>)}</ul></Section>
          <Section title="Planned stations" icon={MapPinned} action="5 stations">{STATIONS.map((station) => <div className="response-station" key={station.id}><i className={station.color} /><b>{station.id}</b><span>{station.place}</span><small>{station.priority}</small></div>)}</Section>
          <Section title="Sample windows" icon={Clock3}><FieldList><Field label="Start" value="29 Jan 2025, 08:00 UTC" numeric={false} /><Field label="End" value="29 Jan 2025, 18:00 UTC" numeric={false} /><Field label="Tide" value="Favorable · slack water ~11:30 UTC" numeric={false} /></FieldList></Section>
          <Section title="Priority / rationale" icon={Shield}>{STATIONS.map((station, index) => <div className="response-priority" key={station.id}><i className={station.color} /><b>{station.id}</b><span>{station.priority}</span><small>{['Inferred highest concentration', 'Near sensitive coastal habitat', 'Confirm outer boundary', 'Down-current monitoring', 'Background reference'][index]}</small></div>)}</Section>
          <Section title="Chain-of-custody & status" icon={FileText}><div className="response-stats response-stats-4"><Stat label="Collected" value="0" /><Stat label="Planned" value="5" /><Stat label="In lab" value="0" /><Stat label="Analysed" value="0" /></div></Section>
          <Section title="Expected information gain" icon={Activity}><ul className="response-checklist">{['Refine slick extent and trajectory model', 'Quantify environmental concentrations', 'Assess risk to coastal / sensitive areas', 'Support response strategy and reporting'].map((item) => <li key={item}><CheckCircle2 size={15} />{item}</li>)}</ul></Section>
        </>}

        {responsePanel === 'alerts' && <>
          <div className="response-stats alert-overview"><Stat label="Active alerts" value={String(activeCount)} tone="red" /><Stat label="Acknowledged" value={String(acknowledged.length)} /><Stat label="Pending action" value={String(Math.max(0, activeCount - 1))} tone="amber" /></div>
          <Section title={`Active alerts (${activeCount})`} icon={Bell} action="View all">
            {ALERTS.filter((alert) => !acknowledged.includes(alert.title)).map((alert) => <article className="response-alert-card" key={alert.title}><header><span className="response-alert-icon"><AlertTriangle size={16} /></span><b>{alert.title}</b><Badge status={alert.severity === 'High' ? 'critical' : 'warning'}>{alert.severity}</Badge></header><div className="response-alert-meta"><span>Triggered<br /><b>29 Jan 2025, {alert.time}</b></span><span>Affected area<br /><b>{alert.zone}</b></span><span>Status<br /><b className="response-red">Active</b></span><span>Ack<br /><b>No</b></span></div><p><ChevronRight size={14} /> Recommended action: {alert.action}</p><button type="button" onClick={() => setAcknowledged((list) => [...list, alert.title])}>Acknowledge alert <Check size={14} /></button></article>)}
          </Section>
          <Section title="Resolved alerts (2)" icon={CheckCircle2}><div className="response-resolved"><CheckCircle2 size={17} /><span><b>High drift toward open sea</b><small>Resolved · 5 h ago</small></span><Badge status="clear">Low</Badge></div><div className="response-resolved"><CheckCircle2 size={17} /><span><b>Asset deviation detected</b><small>Resolved · 7 h ago</small></span><Badge status="watch">Low</Badge></div></Section>
        </>}

        <div className="response-demo-note"><span>DEMO DATA</span> Response assets, impacts, missions and alerts are mock planning details; no actions are sent to real teams.</div>
        {toast && <div className="response-toast" role="status">{toast}</div>}
      </div>
    </StageFrame>
  );
}
