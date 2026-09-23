/**
 * Dashboard: the step back from the chart.
 *
 * The Dispatch composition. A near-black shell, a persistent left rail, and a
 * grid of separated dark cards under a live map. It is the one dark reference
 * that reads as trustworthy, and it earns that with gaps and saturation
 * rather than with density.
 *
 * This is the shift-supervisor surface: nothing selected, everything counted.
 *
 * Still on mock figures. The layout and the components are real; the numbers
 * are not, and every one of them is a placeholder until the queries land.
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Antenna,
  BarChart3,
  FileText,
  Gauge,
  LayoutGrid,
  ListFilter,
  LogOut,
  MoreHorizontal,
  Maximize2,
  Radar,
  Satellite,
  Settings,
  Ship,
  Snowflake,
  Waves,
  Wind,
} from 'lucide-react';
import {
  Badge,
  HealthRow,
  MapLabel,
  MapLegend,
  MapStatusBar,
  Search as SearchField,
  Select,
  Toggle,
} from '../design/components';
import { DETECTIONS, HEALTH, LAYERS, MIX, OPS_NAV, SPARK, SLICKS } from './mock';
import { LayerSwatch } from './swatches';
import { investigate } from './tabs';
import { loadLandRings } from '../forecast/land';
import { CLAIM_STROKE } from '../design/components';
import './dashboard.css';

/** The glyph per chain link. The library stays free of domain icons. */
const HEALTH_ICONS: Record<string, ReactNode> = {
  sar: <Satellite size={15} />,
  ais: <Antenna size={15} />,
  wind: <Wind size={15} />,
  current: <Waves size={15} />,
  ice: <Snowflake size={15} />,
  verify: <Gauge size={15} />,
};

const ICONS: Record<string, typeof Radar> = {
  overview: LayoutGrid,
  detections: Radar,
  vessels: Ship,
  forecasts: Waves,
  reports: FileText,
  analytics: BarChart3,
};

/*
 * The detection map's ground: coastline linework on the graticule, not imagery.
 * An equirectangular box scaled to cover the panel, which at 6° of Gujarat
 * coast is within a pixel of Mercator and needs no projection library.
 */
const EXTENT = { w: 66.2, e: 74.6, s: 17.9, n: 24.1 };
const INCIDENT = '/data/incidents/gulf-of-kutch-04471';

function useRegion() {
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current!);
    return () => ro.disconnect();
  }, []);
  const k = Math.cos((((EXTENT.s + EXTENT.n) / 2) * Math.PI) / 180);
  const scale = Math.max(size.w / ((EXTENT.e - EXTENT.w) * k), size.h / (EXTENT.n - EXTENT.s));
  const cx = (EXTENT.w + EXTENT.e) / 2, cy = (EXTENT.s + EXTENT.n) / 2;
  const xy = ([lon, lat]: [number, number]): [number, number] => [size.w / 2 + (lon - cx) * k * scale, size.h / 2 - (lat - cy) * scale];
  const lonLat = ([x, y]: [number, number]) => [cx + (x - size.w / 2) / (k * scale), cy - (y - size.h / 2) / scale];
  return { ref, size, xy, lonLat };
}

/** Land, the incident's source corridor and drift track, drawn in their claim's line form. */
function RegionMarks({ size, xy }: { size: { w: number; h: number }; xy: (p: [number, number]) => [number, number] }) {
  const [land, setLand] = useState<[number, number][][]>([]);
  const [source, setSource] = useState<[number, number][]>([]);
  const [track, setTrack] = useState<[number, number][]>([]);
  useEffect(() => {
    loadLandRings().then((rings) => setLand(rings.filter((r) => r.some(([x, y]) => x > 60 && x < 80 && y > 10 && y < 30))));
    fetch(`${INCIDENT}/source-hypotheses.json`).then((r) => r.json()).then((h) =>
      setSource(h.hypotheses.filter((x: { scenario: string }) => x.scenario === 'windage_3%').map((x: { centre: { lon: number; lat: number } }) => [x.centre.lon, x.centre.lat])),
    ).catch(() => undefined);
    fetch(`${INCIDENT}/forecast.json`).then((r) => r.json()).then((f) => setTrack(f.track.map((t: { lon: number; lat: number }) => [t.lon, t.lat]))).catch(() => undefined);
  }, []);
  if (!size.w) return null;
  const d = (pts: [number, number][], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${xy(p).map((v) => v.toFixed(1)).join(',')}`).join('') + (close ? 'Z' : '');
  return (
    <svg className="op-ground" width={size.w} height={size.h} aria-hidden="true">
      <path className="op-land" d={land.map((r) => d(r, true)).join('')} />
      {source.length > 1 && <path className="op-source" d={d([...source].reverse())} strokeDasharray={CLAIM_STROKE.reconstructed} />}
      {track.length > 1 && <path className="op-track" d={d(track)} strokeDasharray={CLAIM_STROKE.predicted} />}
      {SLICKS.filter((s) => s.claim === 'observed').map((s) => {
        const [x, y] = xy(s.at);
        return <circle key={s.id} className="op-dot" cx={x} cy={y} r={4} />;
      })}
    </svg>
  );
}

/** Area chart, hand-built from the series. 40 points does not need a library. */
function Spark({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values) * 1.15;
  const pt = (v: number, i: number) => `${(i / (values.length - 1)) * 100},${40 - (v / max) * 40}`;
  const line = values.map(pt).join(' ');
  return (
    <svg className="op-spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,40 ${line} 100,40`} fill={color} opacity="0.22" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DashboardSurface() {
  const [nav, setNav] = useState('overview');
  const [range, setRange] = useState('month');
  const [query, setQuery] = useState('');
  const [layers, setLayers] = useState<Record<string, boolean>>({
    slicks: true,
    backtrack: true,
    forecast: true,
    ais: false,
    wind: false,
  });
  const total = MIX.reduce((sum, part) => sum + part.value, 0);
  const layersOn = LAYERS.filter((layer) => layers[layer.id]).length;
  const region = useRegion();
  const centre = region.lonLat([region.size.w / 2, region.size.h / 2]);
  // Every mark on the dashboard belongs to a catalog record; the reconstruction
  // and the forecast belong to the slick they were run for.
  const open = (id: string) => investigate(id.startsWith('guardians:') ? 'edge:oil_04471' : id);

  return (
    <div className="op">
      {/* ------------------------------------------------------------ rail */}
      <aside className="op-rail">
        <div className="op-brand">
          <Radar size={18} />
          <span>GUARDIANS</span>
        </div>

        <div className="op-user">
          <span className="op-avatar" aria-hidden="true">
            AR
          </span>
          <span className="op-user-text">
            <strong>Anita Rao</strong>
            <small>Watch supervisor</small>
          </span>
        </div>

        <nav aria-label="Sections">
          {OPS_NAV.map((item) => {
            const Icon = ICONS[item.id] ?? LayoutGrid;
            return (
              <button
                key={item.id}
                type="button"
                className={item.id === nav ? 'is-active' : ''}
                aria-current={item.id === nav ? 'page' : undefined}
                onClick={() => setNav(item.id)}
              >
                <Icon size={16} />
                {item.label}
                {item.count !== undefined && <span className="op-nav-count num">{item.count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="op-rail-foot">
          <button type="button">
            <Settings size={16} />
            Settings
          </button>
          <button type="button">
            <LogOut size={16} />
            Log out
          </button>
        </div>

        {/* The reference puts a product advert in this slot. An operator has a
          * better use for it: a standing answer to "can I trust today's run".
          * This is the one part of the cut tactical route worth keeping. */}
        <div className="op-health">
          <h2>Chain health</h2>
          <HealthRow
            items={HEALTH.map((item) => ({ ...item, icon: HEALTH_ICONS[item.id] }))}
            note="Sea ice is five days stale, so nothing north of 60N is drift-corrected in this run. Everything else is within 6 h."
          />
          <span className="op-health-time num">Checked 06:40 UTC</span>
        </div>
      </aside>

      {/* ------------------------------------------------------------ main */}
      <div className="op-main">
        <header className="op-top">
          <span className="op-crumb">
            Overview <span aria-hidden="true">/</span> <strong>Detection map</strong>
          </span>
          <span className="op-top-meta num">
            Today 14 Mar · 6.4 m/s W · sea state 3
          </span>
        </header>

        {/* --------------------------------------------------------- map */}
        <section className="op-map" aria-label="Detection map" ref={region.ref}>
          <RegionMarks size={region.size} xy={region.xy} />
          <div className="op-search">
            <SearchField
              label="Search detections"
              placeholder="Slick id, vessel, or coordinates"
              value={query}
              onChange={setQuery}
              onSubmit={setQuery}
            />
          </div>

          {layers.slicks &&
            SLICKS.map((s) => (
              <MapLabel
                key={s.id}
                id={s.id.split(':')[1]}
                status={s.status}
                label={s.statusLabel}
                onClick={() => open(s.id)}
                style={{ left: region.xy(s.at)[0] + (s.offset?.[0] ?? 0), top: region.xy(s.at)[1] + (s.offset?.[1] ?? 0) }}
              />
            ))}

          <dl className="op-readout">
            <div>
              <dt>Detected today</dt>
              <dd className="num">543</dd>
            </div>
            <div>
              <dt>In active drift</dt>
              <dd className="num">301</dd>
            </div>
            <div>
              <dt>Second-opinion rate</dt>
              <dd className="num">87%</dd>
            </div>
          </dl>

          <div className="op-map-tools">
            <button type="button" aria-label="Full screen">
              <Maximize2 size={14} />
            </button>
          </div>

          <MapLegend shown={layersOn} total={LAYERS.length}>
            {LAYERS.map((layer) => (
              <Toggle
                key={layer.id}
                dense
                label={layer.label}
                description={layer.description}
                value={layer.value}
                swatch={<LayerSwatch kind={layer.swatch} />}
                checked={layers[layer.id] ?? false}
                onChange={(checked) => setLayers({ ...layers, [layer.id]: checked })}
              />
            ))}
          </MapLegend>

          <MapStatusBar
            items={[
              { label: 'centre', value: `${centre[1].toFixed(2)} N ${centre[0].toFixed(2)} E` },
              { label: 'scale', value: '1:2 500 000' },
              { label: 'proj', value: 'EPSG:3857' },
            ]}
          />
        </section>

        {/* ------------------------------------------------------- cards */}
        <section className="op-card op-chart">
          <header>
            <h2>Detections and mean area</h2>
            <Select
              label=""
              value={range}
              options={[
                { value: 'month', label: 'Month' },
                { value: 'quarter', label: 'Quarter' },
              ]}
              onChange={setRange}
            />
          </header>
          {/* The accent, not a ramp position: this is the healthy trend. */}
          <Spark values={SPARK} color="var(--accent-bright)" />
          <footer className="op-axis num">
            {['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'].map((m) => (
              <span key={m}>{m}</span>
            ))}
          </footer>
        </section>

        <section className="op-card op-mix">
          <header>
            <h2>Verification mix</h2>
          </header>
          <div className="op-bar" role="img" aria-label="Verification mix across today's detections">
            {MIX.map((part) => (
              <span
                key={part.label}
                style={{ width: `${(part.value / total) * 100}%`, background: `var(--${part.token})` }}
                title={`${part.label}: ${part.value}`}
              />
            ))}
          </div>
          <ul className="op-legend">
            {MIX.map((part) => (
              <li key={part.label}>
                <span style={{ background: `var(--${part.token})` }} aria-hidden="true" />
                {part.label}
                <b className="num">{part.value}</b>
              </li>
            ))}
          </ul>
        </section>

        <section className="op-card op-count">
          <header>
            <h2>Awaiting review</h2>
          </header>
          <p className="op-count-value num">78</p>
          <p className="op-count-note">
            <span className="num">+5</span> since 00:00 UTC
          </p>
        </section>

        {/* ------------------------------------------------------ queue */}
        <section className="op-card op-queue">
          <header>
            <h2>
              Detections
              <small className="num">6,489 total</small>
            </h2>
            <div className="op-queue-tools">
              <button type="button" aria-label="Filter">
                <ListFilter size={15} />
              </button>
              <button type="button" aria-label="More">
                <MoreHorizontal size={15} />
              </button>
            </div>
          </header>

          <ul className="op-list">
            {DETECTIONS.map((d) => (
              <li key={d.id} className="op-list-open" onClick={() => investigate(d.id)}>
                <div className="op-list-head">
                  <span className="mono">{d.id}</span>
                  <Badge status={d.status}>{d.statusLabel}</Badge>
                </div>
                <div className="op-list-body">
                  <div className="op-route">
                    <span className="op-route-label">Drift track</span>
                    <p>{d.from}</p>
                    <p>{d.to}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>Coast contact</dt>
                      <dd className="num">{d.eta}</dd>
                    </div>
                    <div>
                      <dt>Area</dt>
                      <dd className="num">{d.area}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
