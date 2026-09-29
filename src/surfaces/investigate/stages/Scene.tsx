/**
 * Detection · Scene. The radar picture itself, with no map under it, beside
 * everything the detection says about it.
 *
 * Left half: the scene, in any of its renderings (raw backscatter, the model's
 * probability, the thresholded mask, the outline, ground truth), optionally
 * two at once behind a draggable split. Right half: the filters that choose
 * those renderings, then every figure the detection carries.
 *
 * Where an incident bundle carries the rasters they are used as they are; the
 * histogram and the hover readout are read from the real probability pixels.
 * Records without rasters get renderings derived from their outline.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, Check, Clock, CircleAlert, Columns2, Crosshair, Eye, Layers, Maximize, Minus, Plus, Radar, Ruler, ScanSearch, Target, X,
} from 'lucide-react';
import { Badge } from '../../../design/components';
import type { SlickFeature } from '../../../api/slicks';
import type { Detection, Environment, Incident, SarImagery } from '../../../incidents/types';
import { fetchDetection } from '../../../api/incidents';
import { fetchScene } from '../../../api/scenes';
import { useArtifact } from '../../../incidents/useArtifact';
import { GEOMETRY_LABEL, say } from '../../../incidents/words';
import { VERIFIER, km, km2, latLon, when } from '../../../format';
import { principalAxis, ringsOf } from '../geometry';
import { mockSarImage } from './Detection';
import { estimateAge, type AgeEstimate } from '../../../forecast/age';
import { fromEnvironment } from '../../../forecast/forcing';
import { fetchEnvironment } from '../../../api/incidents';
import { baseProductContext } from './ForecastPage';
import './scene.css';

type LayerId = 'sar' | 'probability' | 'polygon' | 'mask' | 'truth';
type Extent = [number, number, number, number];

interface Raster { status?: string; url?: string; bounds?: Extent; width?: number; height?: number; threshold?: number; note?: string }
interface Part {
  id: string; areaKm2?: number; perimeterM?: number; lengthM?: number; widthM?: number; orientationDeg?: number;
  meanProbability?: number; p95Probability?: number; polygon?: { coordinates: number[][][] }; centroid?: { lon: number; lat: number };
}
/** The fields a bundle's detection.json carries beyond the typed core. */
type RichDetection = Detection & {
  probabilityRaster?: Raster; maskRaster?: Raster;
  groundTruth?: Raster & { reason?: string; detail?: string; sceneMetrics?: Record<string, number> };
  slicks?: Part[]; totalAreaKm2?: number; minAreaPx?: number; interpretation?: string;
};

const MOCK_SCORES = [
  { label: 'Oil slick', value: 0.78 },
  { label: 'Ship wake', value: 0.34 },
  { label: 'Biogenic film', value: 0.28 },
  { label: 'Wind shadow', value: 0.21 },
  { label: 'Rain cell', value: 0.12 },
];

/* ---------------------------------------------------------------- rasters */

/** Probability as a heat ramp: transparent where the model sees sea. */
const HEAT: [number, [number, number, number]][] = [
  [0.1, [27, 42, 107]], [0.35, [70, 188, 234]], [0.6, [230, 190, 66]], [0.8, [255, 128, 44]], [1, [227, 70, 77]],
];
function heat(v: number): [number, number, number, number] {
  if (v < 0.06) return [0, 0, 0, 0];
  let i = HEAT.findIndex(([stop]) => v <= stop);
  if (i <= 0) i = Math.max(1, i === -1 ? HEAT.length - 1 : 1);
  const [a, ca] = HEAT[i - 1];
  const [b, cb] = HEAT[i];
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k, 70 + 185 * Math.min(1, v * 1.1)];
}

interface Analysed { url: string; values: Uint8ClampedArray; width: number; height: number; histogram: number[]; above: number }

/** Read a grayscale raster once: its colourised rendering, its histogram and its pixels for the readout. */
function analyse(source: CanvasImageSource, width: number, height: number, ramp: (v: number) => [number, number, number, number], threshold: number): Analysed {
  const w = Math.min(width, 1024);
  const h = Math.round((height / width) * w);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const values = new Uint8ClampedArray(w * h);
  const histogram = new Array(20).fill(0);
  let above = 0;
  for (let i = 0; i < values.length; i++) {
    const v = img.data[i * 4];
    values[i] = v;
    histogram[Math.min(19, Math.floor((v / 256) * 20))]++;
    if (v / 255 >= threshold) above++;
    const [r, g, b, a] = ramp(v / 255);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), values, width: w, height: h, histogram, above: above * (width / w) * (height / h) };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** A probability field from an outline: the filled shape, blurred, over faint speckle. */
function synthProbability(rings: number[][][], extent: Extent, size = 512, blur = 7) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach(([lon, lat], i) => {
      const x = ((lon - extent[0]) / (extent[2] - extent[0])) * size;
      const y = ((extent[3] - lat) / (extent[3] - extent[1])) * size;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.filter = 'none';
  return canvas;
}

/* ------------------------------------------------------------------ view */

interface EoEntry { status: 'AVAILABLE' | 'NONE'; file?: string; item?: string; platform?: string; datetime?: string; offsetH?: number; cloud?: number; bbox?: [number, number, number, number]; found?: number; tiles?: string[]; searched?: string; maxCloud?: number }
let eoIndex: Promise<Record<string, EoEntry>> | undefined;

/** Sentinel-2 true colour nearest the SAR pass, with the SAR outline drawn on it (tools/eo/fetch_eo.py). */
function OpticalCheck({ slickId, rings, obsAt }: { slickId: string; rings: number[][][]; obsAt: number }) {
  const [e, setE] = useState<EoEntry | null>();
  useEffect(() => {
    eoIndex ??= fetch(`${import.meta.env.BASE_URL}data/eo/index.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    let live = true;
    eoIndex.then((ix) => live && setE(ix[slickId] ?? null));
    return () => void (live = false);
  }, [slickId]);
  if (e === undefined) return null;
  const b = e?.bbox;
  const path = b ? rings.map((r) => r.map(([x, y], i) => `${i ? 'L' : 'M'}${(((x - b[0]) / (b[2] - b[0])) * 1000).toFixed(1)},${(((b[3] - y) / (b[3] - b[1])) * 1000).toFixed(1)}`).join('') + 'Z').join('') : '';
  const off = e?.offsetH ?? 0;
  return (
    <section className="sc-card sc-eo">
      <header className="sc-head">
        <h3><Eye size={15} />Optical cross-check</h3>
        <span className="sc-meta">Sentinel-2 true colour</span>
      </header>
      {e?.status === 'AVAILABLE' && e.file && b ? (
        <div className="sc-eo-body">
          <figure>
            <img src={e.file} alt={`Sentinel-2 true colour, ${e.datetime}`} />
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>
            <figcaption>SAR outline over the optical pass</figcaption>
          </figure>
          <dl className="sc-rows">
            <div><dt>Pass</dt><dd className="num">{when.format(Date.parse(e.datetime!))} UTC</dd></div>
            <div><dt>From the SAR pass</dt><dd className="num">{off >= 0 ? '+' : '−'}{Math.abs(off).toFixed(1)} h {Math.abs(off) > 12 ? <small>oil will have moved; compare shape, not position</small> : <small>close in time</small>}</dd></div>
            <div><dt>Cloud</dt><dd className="num">{e.cloud?.toFixed(1)} % of the tile</dd></div>
            <div><dt>Platform</dt><dd>{e.platform?.replace('Sentinel-', 'Sentinel-')} · {e.tiles?.length ?? 1} tile{(e.tiles?.length ?? 1) > 1 ? 's' : ''} merged</dd></div>
            <div><dt>Scene</dt><dd className="mono sc-eo-id">{e.item}</dd></div>
            <div><dt>Passes searched</dt><dd className="num">{e.found} within ±5 days</dd></div>
          </dl>
          <p className="sc-note">Optical imagery confirms what SAR cannot: sheen colour, sediment plumes and algal blooms that mimic oil in radar. Thin sheen is often invisible in true colour, so no visible slick is not evidence of no oil.</p>
        </div>
      ) : (
        <p className="sc-note">No Sentinel-2 pass under {e?.maxCloud ?? 40} % cloud within ±5 days{e?.found ? ` (${e.found} passes, all cloudy)` : ''}. The detection rests on SAR alone.</p>
      )}
    </section>
  );
}

/** The two methods' ranges and the combined band, on one 0–48 h axis. */
function AgeBar({ age }: { age: AgeEstimate }) {
  const max = Math.max(24, Math.ceil(Math.max(age.fay[1], age.lehr[1]) / 6) * 6);
  const x = (h: number) => `${(Math.min(h, max) / max) * 100}%`;
  const bar = (r: [number, number], cls: string, label: string) => (
    <div className="sc-agebar-row"><span>{label}</span><div><i className={cls} style={{ left: x(r[0]), width: `calc(${x(r[1])} - ${x(r[0])})` }} /></div></div>
  );
  return (
    <div className="sc-agebar">
      {bar(age.fay, 'is-fay', 'Fay')}
      {bar(age.lehr, 'is-lehr', 'Lehr')}
      {bar([age.lowH, age.highH], 'is-band', 'Estimate')}
      <div className="sc-agebar-axis num"><span /><div>{Array.from({ length: max / 6 + 1 }, (_, k) => <em key={k} style={{ left: x(k * 6) }}>{k * 6} h</em>)}</div></div>
    </div>
  );
}

export function SceneView({ slick, incident, incidentId }: { slick: SlickFeature; incident: Incident | undefined; incidentId: string | undefined }) {
  const artifact = useArtifact<Detection>(incidentId, fetchDetection);
  const detection = artifact && artifact !== 'error' ? (artifact as RichDetection) : undefined;
  const sceneId = typeof slick.properties.scene === 'string' ? slick.properties.scene : undefined;
  const bundledSar = detection?.sarImagery;
  const catalog = useArtifact<SarImagery>(bundledSar?.status !== 'AVAILABLE' ? sceneId : undefined, fetchScene);
  const sar = bundledSar?.status === 'AVAILABLE' ? bundledSar : catalog && catalog !== 'error' && catalog.status === 'AVAILABLE' ? catalog : undefined;

  const p = slick.properties;
  const rings = ringsOf(slick.geometry);
  // Wind at the pass: the bundle's when it has one, else the slick's own scenario value.
  const envArtifact = useArtifact<Environment>(incidentId, fetchEnvironment);
  const centreLL = Array.isArray(p.centroid) ? { lon: Number(p.centroid[0]), lat: Number(p.centroid[1]) } : incident?.centre ?? { lon: 0, lat: 0 };
  const obsAt = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(String(p.observedAt));
  const windMs = fromEnvironment(envArtifact && envArtifact !== 'error' ? envArtifact : undefined, centreLL, obsAt)?.windSpeed ?? baseProductContext(slick, incident).windSpeedMs;
  const age = useMemo(() => estimateAge({ areaM2: Number(p.areaM2) || 0, windMs }), [p.areaM2, windMs]);
  const mock = useMemo(() => mockSarImage(slick.id, rings), [slick.id]);
  const extent: Extent | undefined = sar?.bounds ?? mock?.extent;
  const sarUrl = sar?.url ?? mock?.url;
  const threshold = detection?.threshold ?? detection?.maskRaster?.threshold ?? 0.7;
  const probRaster = detection?.probabilityRaster?.status === 'AVAILABLE' ? detection.probabilityRaster : undefined;
  const maskRaster = detection?.maskRaster?.status === 'AVAILABLE' ? detection.maskRaster : undefined;
  const truth = detection?.groundTruth?.status === 'AVAILABLE' ? detection.groundTruth : undefined;
  const derived = !probRaster;

  // Colourised renderings plus the real pixel values behind them.
  const [prob, setProb] = useState<Analysed>();
  const [mask, setMask] = useState<Analysed>();
  const [truthImg, setTruthImg] = useState<Analysed>();
  useEffect(() => {
    let live = true;
    setProb(undefined);
    setMask(undefined);
    setTruthImg(undefined);
    if (!extent) return;
    const maskRamp = (v: number): [number, number, number, number] => (v >= 0.5 ? [255, 128, 44, 235] : [14, 20, 24, 255]);
    const truthRamp = (v: number): [number, number, number, number] => (v >= 0.5 ? [75, 212, 82, 235] : [14, 20, 24, 255]);
    (async () => {
      if (probRaster?.url) {
        const img = await loadImage(probRaster.url);
        if (live) setProb(analyse(img, img.width, img.height, heat, threshold));
      } else if (rings.length) {
        const c = synthProbability(rings, extent);
        if (live) setProb(analyse(c, c.width, c.height, heat, threshold));
      }
      if (maskRaster?.url) {
        const img = await loadImage(maskRaster.url);
        if (live) setMask(analyse(img, img.width, img.height, maskRamp, 0.5));
      } else if (rings.length) {
        const c = synthProbability(rings, extent, 512, 0);
        if (live) setMask(analyse(c, c.width, c.height, maskRamp, 0.5));
      }
      if (truth?.url) {
        const img = await loadImage(truth.url);
        if (live) setTruthImg(analyse(img, img.width, img.height, truthRamp, 0.5));
      }
    })().catch(() => undefined);
    return () => void (live = false);
  }, [probRaster?.url, maskRaster?.url, truth?.url, extent?.join(), slick.id]);

  // Parts: the bundle's own measurements when it has them, else the record's.
  const centreValue = Array.isArray(p.centroid) ? p.centroid : undefined;
  const centre = centreValue ? { lon: Number(centreValue[0]), lat: Number(centreValue[1]) } : incident?.centre;
  const axis = principalAxis(rings, centre);
  const parts: Part[] = detection?.slicks?.length
    ? detection.slicks
    : [{
      id: slick.id, areaKm2: Number(p.areaM2) / 1e6, lengthM: axis ? axis.lengthKm * 1000 : Number(p.lengthM), widthM: axis ? axis.widthKm * 1000 : undefined,
      orientationDeg: axis?.bearingDeg, meanProbability: Number(p.probability ?? 0), p95Probability: Number(p.probabilityP95 ?? p.probability ?? 0),
    }];
  const main = [...parts].sort((a, b) => (b.areaKm2 ?? 0) - (a.areaKm2 ?? 0))[0];
  const partRings = detection?.slicks?.length ? detection.slicks.flatMap((s) => s.polygon?.coordinates ?? []) : rings;

  const available: { id: LayerId; label: string; meta: string; icon: typeof Radar }[] = [
    { id: 'sar', label: 'Raw SAR', meta: sar ? `${sar.band?.split(' ')[0] ?? 'VV'} · σ⁰ ${sar.stretch ? `${sar.stretch.lowDb.toFixed(1)}…${sar.stretch.highDb.toFixed(1)} dB` : 'backscatter'}` : 'Quicklook from outline', icon: Radar },
    { id: 'probability', label: 'Probability', meta: `${derived ? 'Derived' : '8-bit'} · ${prob ? `${prob.width}²` : '…'} px`, icon: Activity },
    { id: 'polygon', label: 'Slick polygon', meta: `${parts.length} part${parts.length === 1 ? '' : 's'} · vector`, icon: Target },
    { id: 'mask', label: 'Slick mask', meta: `Threshold ${threshold.toFixed(2)}`, icon: Layers },
    ...(truth ? [{ id: 'truth' as const, label: 'Ground truth', meta: `IoU ${truth.sceneMetrics?.iou?.toFixed(2) ?? '—'}`, icon: Check }] : []),
  ];

  const [compare, setCompare] = useState(true);
  const [dims, setDims] = useState(false);
  const [left, setLeft] = useState<LayerId>('sar');
  const [right, setRight] = useState<LayerId>('probability');
  const [single, setSingle] = useState<LayerId>('polygon');

  const probability = main.meanProbability ?? Number(p.probability ?? 0);
  const p95 = main.p95Probability ?? probability;
  const verifier = String(p.verifier ?? '');
  const lookalike = p.lookalikeWarning === true || verifier === 'LOOKALIKE_WARNING';
  const observedAt = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(p.observedAt);
  const pxAreaKm2 = extent && prob ? (((extent[2] - extent[0]) * 111.32 * Math.cos((((extent[1] + extent[3]) / 2) * Math.PI) / 180)) * ((extent[3] - extent[1]) * 110.57)) / (prob.width * prob.height) : undefined;

  return (
    <div className="scene">
      <SceneImage
        extent={extent} sarUrl={sarUrl} prob={prob} mask={mask} truth={truthImg} rings={partRings}
        compare={compare} left={compare ? left : single} right={right} threshold={threshold}
        dims={dims && centre ? {
          centre: main.centroid ?? centre, bearingDeg: main.orientationDeg ?? axis?.bearingDeg ?? 0,
          lengthKm: (main.lengthM ?? Number(p.lengthM)) / 1000, widthKm: (main.widthM ?? 0) / 1000,
          areaKm2: main.areaKm2 ?? Number(p.areaM2) / 1e6, perimeterKm: main.perimeterM ? main.perimeterM / 1000 : undefined,
        } : undefined}
        labels={Object.fromEntries(available.map((a) => [a.id, a.label])) as Record<LayerId, string>}
      />

      <aside className="scene-pane" aria-label="Detection details">
        {/* Verdict */}
        <section className={`sc-card sc-verdict ${lookalike ? 'is-watch' : ''}`}>
          <span className="sc-verdict-icon">{lookalike ? <CircleAlert size={20} /> : <Check size={20} />}</span>
          <div>
            <h2>{lookalike ? 'Review this detection: possible look-alike' : 'Possible oil slick detected'}</h2>
            <p>{detection?.interpretation ?? 'A dark, coherent radar feature. Its composition needs corroboration before it is called oil.'}</p>
          </div>
          <div className="sc-verdict-badges">
            <Badge claim="observed" />
            <Badge status={lookalike ? 'warning' : verifier === 'MULTI_MODEL_SUPPORTED' ? 'clear' : 'inactive'}>{VERIFIER[verifier] ?? 'Unverified'}</Badge>
          </div>
        </section>

        {/* Filters */}
        <section className="sc-card sc-filters">
          <header className="sc-head">
            <h3><Eye size={15} />View</h3>
            <span className="sc-switches">
              <button type="button" className="sc-switch" aria-pressed={dims} onClick={() => setDims(!dims)}>
                <Ruler size={14} />Dimensions {dims ? 'on' : 'off'}
              </button>
              <button type="button" className="sc-switch" aria-pressed={compare} onClick={() => setCompare(!compare)}>
                <Columns2 size={14} />Compare {compare ? 'on' : 'off'}
              </button>
            </span>
          </header>
          {(compare ? (['Left', 'Right'] as const) : (['Show'] as const)).map((side) => {
            const value = side === 'Left' ? left : side === 'Right' ? right : single;
            const set = side === 'Left' ? setLeft : side === 'Right' ? setRight : setSingle;
            return (
              <div key={side} className="sc-filter-row">
                <span className="sc-filter-side">{side}</span>
                <div className="sc-filter-buttons" role="group" aria-label={`${side} view`}>
                  {available.map(({ id, label, meta, icon: Icon }) => (
                    <button key={id} type="button" aria-pressed={value === id} onClick={() => set(id)}>
                      <Icon size={14} />
                      <span><b>{label}</b><small>{meta}</small></span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {/* Headline figures */}
        <section className="sc-tiles">
          <Tile label="Area" value={km2(Number(p.areaM2))} note={detection?.totalAreaKm2 ? `${parts.length} part${parts.length === 1 ? '' : 's'} total` : 'outline'} />
          <Tile label="Length" value={km(main.lengthM ?? Number(p.lengthM))} note="major axis" />
          <Tile label="Width" value={main.widthM ? km(main.widthM) : '—'} note="minor axis" />
          <Tile label="Aspect" value={main.lengthM && main.widthM ? `${(main.lengthM / main.widthM).toFixed(1)} : 1` : '—'} note="elongation" />
          <Tile label="Orientation" value={main.orientationDeg !== undefined ? `${main.orientationDeg.toFixed(0)}°` : '—'} note="true north" />
          <Tile label="Perimeter" value={main.perimeterM ? km(main.perimeterM) : '—'} note="largest part" />
          <Tile label="Mean P" value={probability.toFixed(3)} note="inside outline" tone={probability >= 0.7 ? 'clear' : 'warning'} />
          <Tile label="P95" value={p95.toFixed(3)} note="95th percentile" tone={p95 >= 0.7 ? 'clear' : 'warning'} />
        </section>


        <OpticalCheck slickId={slick.id} rings={rings} obsAt={obsAt} />

        {/* Age */}
        <section className="sc-card sc-age">
          <header className="sc-head">
            <h3><Clock size={15} />Estimated age</h3>
            <span className="sc-meta">from how far the oil has spread</span>
          </header>
          <div className="sc-age-main">
            <b className="num">{age.lowH.toFixed(0)}–{age.highH.toFixed(0)} h</b>
            <span>released about <b className="num">{age.bestH.toFixed(0)} h</b> before the pass, between {when.format(obsAt - age.highH * 3_600_000)} and {when.format(obsAt - age.lowH * 3_600_000)} UTC</span>
          </div>
          <AgeBar age={age} />
          <dl className="sc-rows">
            <div><dt>Fay, surface tension</dt><dd className="num">{age.fay[0].toFixed(1)}–{age.fay[1].toFixed(1)} h <small>volume-free; ignores wind, so an upper bound</small></dd></div>
            <div><dt>Lehr et al., wind-assisted</dt><dd className="num">{age.lehr[0].toFixed(1)}–{age.lehr[1].toFixed(1)} h <small>{windMs.toFixed(1)} m/s wind, 10–100 µm mean thickness</small></dd></div>
            <div><dt>Agreement</dt><dd>{age.agree ? 'The two laws overlap; the band is their overlap.' : 'The laws do not overlap; the band spans the gap between them.'}</dd></div>
          </dl>
          <p className="sc-note">The backward trace on Forecast & impact runs to this age to place the origin, and vessels that passed inside this window rank higher.</p>
        </section>

        <div className="sc-grid">
          {/* Histogram */}
          <section className="sc-card sc-span">
            <header className="sc-head">
              <h3><Activity size={15} />Probability distribution</h3>
              <span className="sc-meta num">{prob ? `${Math.round(prob.above).toLocaleString('en-GB')} px ≥ ${threshold.toFixed(2)}${pxAreaKm2 ? ` · ${(prob.above * pxAreaKm2).toFixed(2)} km²` : ''}` : 'Reading raster…'}</span>
            </header>
            {prob ? <Histogram bins={prob.histogram} threshold={threshold} /> : <div className="sc-hist-empty" />}
            <p className="sc-foot">{derived ? 'Derived from the outline: this record carries no probability raster.' : `Read from ${probRaster?.width ?? ''}×${probRaster?.height ?? ''} probability raster; log scale. ${detection?.probabilityRaster?.note ?? ''}`}</p>
          </section>

          {/* Confidence */}
          <section className="sc-card">
            <header className="sc-head"><h3><Target size={15} />Model confidence</h3></header>
            <Bar label="Primary · mean" value={probability} note={detection?.modelId ?? 'Edge-guided CNN'} />
            <Bar label="Primary · p95" value={p95} />
            <Bar label="Validator · agreement" value={verifier === 'MULTI_MODEL_SUPPORTED' ? 0.93 : verifier === 'LOOKALIKE_WARNING' ? 0.21 : 0} note={VERIFIER[verifier] ?? 'Not run'} muted={!verifier || verifier === 'SECOND_OPINION_UNAVAILABLE'} />
            <Bar label="Threshold" value={threshold} note="mask cut-off" muted />
          </section>

          {/* Look-alike */}
          <section className="sc-card">
            <header className="sc-head"><h3><ScanSearch size={15} />Look-alike scorecard</h3><span className="sc-meta">illustrative</span></header>
            {MOCK_SCORES.map((s, i) => <Bar key={s.label} label={s.label} value={i === 0 && lookalike ? 0.44 : s.value} best={i === 0} />)}
          </section>

          <section className="sc-card">
            <header className="sc-head"><h3><Check size={15} />Evidence for a slick</h3></header>
            <ul className="sc-list is-for">
              <li>Dark, coherent backscatter feature</li>
              <li>{main.lengthM && main.widthM && main.lengthM / main.widthM > 1.8 ? 'Elongated outline, typical of drift' : 'Compact outline with sharp edges'}</li>
              <li>{probability >= 0.7 ? `Mean probability ${probability.toFixed(2)} above the ${threshold.toFixed(2)} cut-off` : 'Outline recovered by segmentation'}</li>
              {verifier === 'MULTI_MODEL_SUPPORTED' && <li>Second model agrees on the outline</li>}
            </ul>
          </section>
          <section className="sc-card">
            <header className="sc-head"><h3><X size={15} />Against or unknown</h3></header>
            <ul className="sc-list is-against">
              <li>Single polarisation; no polarimetric confirmation</li>
              <li>{truth ? 'Ground truth available for comparison' : detection?.groundTruth?.detail ?? 'No aerial or vessel confirmation yet'}</li>
              {lookalike && <li>Second model flagged a possible look-alike</li>}
              {verifier === 'SECOND_OPINION_UNAVAILABLE' && <li>No second opinion was run</li>}
            </ul>
          </section>

          {/* Parts */}
          <section className="sc-card sc-span">
            <header className="sc-head"><h3><Ruler size={15} />Parts</h3><span className="sc-meta num">{parts.length} · {detection?.metricCrs ?? 'metric CRS'}</span></header>
            <div className="sc-table-wrap">
              <table className="sc-table">
                <thead><tr><th>Part</th><th>Area km²</th><th>Length</th><th>Width</th><th>Orient.</th><th>Mean P</th><th>P95</th></tr></thead>
                <tbody>
                  {parts.map((part) => (
                    <tr key={part.id}>
                      <td className="mono">{part.id.split('-').pop()}</td>
                      <td>{part.areaKm2?.toFixed(3) ?? '—'}</td>
                      <td>{part.lengthM ? km(part.lengthM) : '—'}</td>
                      <td>{part.widthM ? km(part.widthM) : '—'}</td>
                      <td>{part.orientationDeg !== undefined ? `${part.orientationDeg.toFixed(0)}°` : '—'}</td>
                      <td>{part.meanProbability?.toFixed(3) ?? '—'}</td>
                      <td>{part.p95Probability?.toFixed(3) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Details */}
          <section className="sc-card sc-span">
            <header className="sc-head"><h3><Crosshair size={15} />Acquisition and model</h3></header>
            <dl className="sc-rows">
              <Row k="Acquired" v={`${when.format(observedAt)} UTC`} />
              <Row k="Sensor" v={String(incident?.sensor ?? p.sensor ?? 'Sentinel-1 SAR')} />
              <Row k="Scene" v={String(p.scene ?? '—')} mono />
              <Row k="Band" v={sar?.band ?? String(p.polarization ?? 'VV')} />
              <Row k="Stretch" v={sar?.stretch ? `${sar.stretch.method}` : 'Display only'} />
              <Row k="Centroid" v={latLon(p.centroid)} mono />
              <Row k="Model" v={detection?.modelId ?? 'Edge-guided CNN'} />
              <Row k="Version" v={detection?.modelVersion ?? '—'} mono />
              <Row k="Raster" v={detection?.rasterSize ? `${detection.rasterSize.width} × ${detection.rasterSize.height}` : prob ? `${prob.width} × ${prob.height} (derived)` : '—'} />
              <Row k="Min. area" v={detection?.minAreaPx ? `${detection.minAreaPx} px` : '—'} />
              <Row k="Geometry" v={say(GEOMETRY_LABEL, String(p.geometryKind ?? '')) ?? 'Polygon'} />
              <Row k="Generated" v={detection?.generatedAt ? `${when.format(Date.parse(detection.generatedAt))} UTC` : '—'} />
            </dl>
          </section>

          {truth?.sceneMetrics && (
            <section className="sc-card sc-span">
              <header className="sc-head"><h3><Check size={15} />Against ground truth</h3><span className="sc-meta">scene metrics</span></header>
              <div className="sc-tiles is-inner">
                {(['iou', 'dice', 'precision', 'recall'] as const).map((k) => <Tile key={k} label={k.toUpperCase()} value={truth.sceneMetrics![k]?.toFixed(3) ?? '—'} tone="clear" />)}
              </div>
            </section>
          )}

          <section className="sc-card sc-span">
            <header className="sc-head"><h3><Crosshair size={15} />Recommended next checks</h3></header>
            <ol className="sc-next">
              <li>Check vessels near the scene at acquisition time <small>Map page</small></li>
              <li>Compare the next satellite pass over this position</li>
              <li>Review local wind and surface conditions for look-alikes</li>
            </ol>
          </section>
        </div>
      </aside>
    </div>
  );
}

/* ----------------------------------------------------------- image viewer */

function SceneImage({
  extent, sarUrl, prob, mask, truth, rings, compare, left, right, threshold, labels, dims,
}: {
  dims?: Dims;
  extent?: Extent; sarUrl?: string; prob?: Analysed; mask?: Analysed; truth?: Analysed; rings: number[][][];
  compare: boolean; left: LayerId; right: LayerId; threshold: number; labels: Record<LayerId, string>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [split, setSplit] = useState(50);
  const [hover, setHover] = useState<{ lon: number; lat: number; p?: number; px: [number, number] }>();
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | 'split' | undefined>(undefined);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  // The square stage, centred in the box.
  const S = Math.min(size.w, size.h);
  const off = { x: (size.w - S) / 2, y: (size.h - S) / 2 };
  const toFrac = ([lon, lat]: number[]) => (extent ? [(lon - extent[0]) / (extent[2] - extent[0]), (extent[3] - lat) / (extent[3] - extent[1])] : [0.5, 0.5]);

  const fitSlick = () => {
    if (!S || !rings.length) return setView({ s: 1, x: 0, y: 0 });
    const f = rings.flat().map(toFrac);
    const [x0, x1] = [Math.min(...f.map((q) => q[0])), Math.max(...f.map((q) => q[0]))];
    const [y0, y1] = [Math.min(...f.map((q) => q[1])), Math.max(...f.map((q) => q[1]))];
    const s = Math.min(24, Math.max(1, 0.45 / Math.max(x1 - x0, y1 - y0, 0.001)));
    const cx = off.x + ((x0 + x1) / 2) * S;
    const cy = off.y + ((y0 + y1) / 2) * S;
    setView({ s, x: size.w / 2 - s * cx, y: size.h / 2 - s * cy });
  };
  const fitScene = () => setView({ s: 1, x: 0, y: 0 });
  const zoom = (k: number, mx = size.w / 2, my = size.h / 2) =>
    setView((v) => {
      const s = Math.min(40, Math.max(0.8, v.s * k));
      const r = s / v.s;
      return { s, x: mx - (mx - v.x) * r, y: my - (my - v.y) * r };
    });

  // Open on the slick, not the whole scene.
  // Refit when the real scene bounds replace the placeholder ones.
  const fitted = useRef('');
  useEffect(() => {
    const key = extent?.join() ?? '';
    if (S > 0 && extent && rings.length && fitted.current !== key) {
      fitted.current = key;
      fitSlick();
    }
  }, [S, extent?.join(), rings.length]);

  const onMove = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    if (drag.current === 'split') setSplit(Math.min(98, Math.max(2, (mx / r.width) * 100)));
    else if (drag.current) {
      const d = drag.current;
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y) }));
    }
    if (!extent || !S) return;
    const fx = ((mx - view.x) / view.s - off.x) / S;
    const fy = ((my - view.y) / view.s - off.y) / S;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return setHover(undefined);
    const lon = extent[0] + fx * (extent[2] - extent[0]);
    const lat = extent[3] - fy * (extent[3] - extent[1]);
    const px: [number, number] = prob ? [Math.floor(fx * prob.width), Math.floor(fy * prob.height)] : [0, 0];
    setHover({ lon, lat, px, p: prob ? prob.values[px[1] * prob.width + px[0]] / 255 : undefined });
  };

  // Metres per screen pixel, for the scale bar.
  const kmPerPx = extent && S ? ((extent[2] - extent[0]) * 111.32 * Math.cos((((extent[1] + extent[3]) / 2) * Math.PI) / 180)) / (S * view.s) : 0;
  const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find((k) => k / kmPerPx >= 70) ?? 20;

  const layer = (id: LayerId) => {
    const stage = { left: off.x, top: off.y, width: S, height: S };
    const img = (url: string | undefined, className = '') => url && <img src={url} alt="" className={`sc-img ${className}`} style={stage} draggable={false} />;
    const outline = (
      <svg className="sc-outline" style={stage} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        <path d={rings.map((ring) => ring.map((pt, i) => `${i ? 'L' : 'M'}${(toFrac(pt)[0] * 1000).toFixed(2)},${(toFrac(pt)[1] * 1000).toFixed(2)}`).join('') + 'Z').join('')} vectorEffect="non-scaling-stroke" />
      </svg>
    );
    return (
      <div className={`sc-stage${dims ? " is-dimmed" : ""}`} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
        {id === 'sar' && img(sarUrl)}
        {id === 'probability' && <>{img(sarUrl, 'is-dim')}{img(prob?.url, 'is-pixel')}</>}
        {id === 'polygon' && <>{img(sarUrl)}{outline}</>}
        {id === 'mask' && img(mask?.url, 'is-pixel')}
        {id === 'truth' && <>{img(truth?.url, 'is-pixel')}{outline}</>}
      </div>
    );
  };

  const legend = (id: LayerId) =>
    id === 'probability' ? (
      <span className="sc-ramp"><i />0<b style={{ left: `${threshold * 100}%` }} />1</span>
    ) : id === 'mask' ? <span className="sc-key"><i className="k-mask" />≥ {threshold.toFixed(2)}</span>
      : id === 'polygon' ? <span className="sc-key"><i className="k-poly" />outline</span>
        : id === 'truth' ? <span className="sc-key"><i className="k-truth" />labelled oil</span> : null;

  return (
    <div
      className="sc-view"
      ref={box}
      onWheel={(e) => {
        const r = box.current!.getBoundingClientRect();
        zoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = (e.target as HTMLElement).closest('.sc-split') ? 'split' : { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      }}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = undefined)}
      onPointerLeave={() => setHover(undefined)}
    >
      {S > 0 && (
        <>
          <div className="sc-side">{layer(left)}</div>
          {compare && <div className="sc-side" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>{layer(right)}</div>}
          {compare && (
            <div className="sc-split" style={{ left: `${split}%` }} role="separator" aria-label="Drag to compare" aria-valuenow={Math.round(split)}>
              <span><Columns2 size={14} /></span>
            </div>
          )}
        </>
      )}

      <div className="sc-tag is-left">{compare ? 'L' : ''}<b>{labels[left]}</b>{legend(left)}</div>
      {compare && <div className="sc-tag is-right"><b>{labels[right]}</b>{legend(right)}R</div>}

      {dims && extent && S > 0 && (
        <CadDims dims={dims} rings={rings} toScreen={([lon, lat]) => {
          const [fx, fy] = toFrac([lon, lat]);
          return [view.x + view.s * (off.x + fx * S), view.y + view.s * (off.y + fy * S)];
        }} />
      )}

      <div className="sc-tools">
        <button type="button" onClick={fitScene}><Maximize size={14} />Fit scene</button>
        <button type="button" onClick={fitSlick}><Target size={14} />Fit slick</button>
        <button type="button" onClick={() => zoom(1.4)} aria-label="Zoom in"><Plus size={14} /></button>
        <button type="button" onClick={() => zoom(1 / 1.4)} aria-label="Zoom out"><Minus size={14} /></button>
      </div>

      <div className="sc-status num">
        <span className="sc-scale"><i style={{ width: kmPerPx > 0 ? nice / kmPerPx : 0 }} />{nice < 1 ? `${nice * 1000} m` : `${nice} km`}</span>
        <span>×{view.s.toFixed(1)}</span>
        {hover ? (
          <>
            <span className="mono">{hover.lat.toFixed(4)}° N {hover.lon.toFixed(4)}° E</span>
            {hover.p !== undefined && <span>P <b>{hover.p.toFixed(2)}</b></span>}
            <span className="mono">px {hover.px[0]},{hover.px[1]}</span>
          </>
        ) : <span>Hover the scene for position and probability</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'clear' | 'warning' }) {
  return (
    <div className="sc-tile" data-tone={tone}>
      <span>{label}</span>
      <b className="num">{value}</b>
      {note && <small>{note}</small>}
    </div>
  );
}

function Bar({ label, value, note, best, muted }: { label: string; value: number; note?: string; best?: boolean; muted?: boolean }) {
  return (
    <div className="sc-bar" data-best={best || undefined} data-muted={muted || undefined}>
      <span>{label}{note && <small>{note}</small>}</span>
      <i><em style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} /></i>
      <b className="num">{muted && value === 0 ? '—' : value.toFixed(2)}</b>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div><dt>{k}</dt><dd className={mono ? 'mono' : undefined}>{v}</dd></div>;
}

function Histogram({ bins, threshold }: { bins: number[]; threshold: number }) {
  const max = Math.log10(Math.max(...bins) + 1);
  return (
    <div className="sc-hist" role="img" aria-label="Histogram of model probability">
      {bins.map((n, i) => (
        <span key={i} data-above={(i + 1) / 20 > threshold || undefined} style={{ height: `${(Math.log10(n + 1) / max) * 100}%` }} title={`${(i / 20).toFixed(2)}–${((i + 1) / 20).toFixed(2)}: ${n.toLocaleString('en-GB')} px`} />
      ))}
      <b style={{ left: `${threshold * 100}%` }}><small>{threshold.toFixed(2)}</small></b>
      <em className="is-lo">0</em><em className="is-hi">1</em>
    </div>
  );
}

/* ------------------------------------------------------- CAD dimensions */

interface Dims { centre: { lon: number; lat: number }; bearingDeg: number; lengthKm: number; widthKm: number; areaKm2: number; perimeterKm?: number }
type Pt = [number, number];

const fmtKm = (v: number) => (v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(2)} km`);

/** A point so many km along a bearing from another, in lon/lat. */
function travel(c: { lon: number; lat: number }, bearingDeg: number, dKm: number): Pt {
  const b = (bearingDeg * Math.PI) / 180;
  return [c.lon + (Math.sin(b) * dKm) / (111.32 * Math.cos((c.lat * Math.PI) / 180)), c.lat + (Math.cos(b) * dKm) / 110.57];
}

/**
 * Drafting-style dimensions, drawn in screen space so line weights and text
 * stay constant at any zoom: aligned dimensions for the two axes, overall
 * extents along the bottom and left, the orientation angle from north, centre
 * lines through the centroid and a leader carrying area and perimeter.
 */
function CadDims({ dims, rings, toScreen }: { dims: Dims; rings: number[][][]; toScreen: (p: number[]) => Pt }) {
  const c = toScreen([dims.centre.lon, dims.centre.lat]);
  const a1 = toScreen(travel(dims.centre, dims.bearingDeg, -dims.lengthKm / 2));
  const a2 = toScreen(travel(dims.centre, dims.bearingDeg, dims.lengthKm / 2));
  const w1 = toScreen(travel(dims.centre, dims.bearingDeg + 90, -dims.widthKm / 2));
  const w2 = toScreen(travel(dims.centre, dims.bearingDeg + 90, dims.widthKm / 2));
  const pts = rings.flat();
  if (!pts.length) return null;
  const lons = pts.map((q) => q[0]);
  const lats = pts.map((q) => q[1]);
  const [w, e, so, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const ewKm = (e - w) * 111.32 * Math.cos((((so + n) / 2) * Math.PI) / 180);
  const nsKm = (n - so) * 110.57;
  const sw = toScreen([w, so]);
  const ne = toScreen([e, n]);
  const axisPx = Math.hypot(a2[0] - a1[0], a2[1] - a1[1]);
  const r = Math.max(28, axisPx * 0.22);
  const bRad = (dims.bearingDeg * Math.PI) / 180;
  const arcEnd: Pt = [c[0] + Math.sin(bRad) * r, c[1] - Math.cos(bRad) * r];
  const span = Math.max(ne[0] - sw[0], sw[1] - ne[1]) + 80;
  const top = toScreen(pts.reduce((best, q) => (q[1] > best[1] ? q : best), pts[0]));

  return (
    <svg className="sc-cad" aria-hidden="true">
      <defs>
        <marker id="cad-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M0,1.5 L10,5 L0,8.5 Z" />
        </marker>
      </defs>
      <g className="cad-centre">
        <line x1={c[0] - span / 2} y1={c[1]} x2={c[0] + span / 2} y2={c[1]} />
        <line x1={c[0]} y1={c[1] - span / 2} x2={c[0]} y2={c[1] + span / 2} />
      </g>
      <Aligned a={sw} b={[ne[0], sw[1]]} offset={34} label={`${fmtKm(ewKm)} E–W`} />
      <Aligned a={sw} b={[sw[0], ne[1]]} offset={-34} label={`${fmtKm(nsKm)} N–S`} />
      <Aligned a={a1} b={a2} offset={-(Math.hypot(w2[0] - w1[0], w2[1] - w1[1]) / 2 + 30)} label={`L ${fmtKm(dims.lengthKm)}`} major />
      {dims.widthKm > 0 && <Aligned a={w1} b={w2} offset={axisPx / 2 + 26} label={`W ${fmtKm(dims.widthKm)}`} major />}
      <line className="cad-axis" x1={a1[0]} y1={a1[1]} x2={a2[0]} y2={a2[1]} />
      {dims.widthKm > 0 && <line className="cad-axis" x1={w1[0]} y1={w1[1]} x2={w2[0]} y2={w2[1]} />}
      <g className="cad-angle">
        <line x1={c[0]} y1={c[1]} x2={c[0]} y2={c[1] - r * 1.3} />
        <path d={`M${c[0]},${c[1] - r} A${r},${r} 0 ${dims.bearingDeg > 180 ? 1 : 0} 1 ${arcEnd[0]},${arcEnd[1]}`} markerEnd="url(#cad-arrow)" />
        <text x={c[0] + Math.sin(bRad / 2) * (r + 16)} y={c[1] - Math.cos(bRad / 2) * (r + 16)}>{dims.bearingDeg.toFixed(0)}°</text>
        <text className="cad-n" x={c[0]} y={c[1] - r * 1.3 - 9}>N</text>
      </g>
      <circle className="cad-dot" cx={c[0]} cy={c[1]} r={3.5} />
      <g className="cad-leader">
        <polyline points={`${top[0]},${top[1]} ${top[0] + 46},${top[1] - 46} ${top[0] + 62},${top[1] - 46}`} markerStart="url(#cad-arrow)" />
        <text x={top[0] + 68} y={top[1] - 52}>A {dims.areaKm2.toFixed(3)} km²</text>
        {dims.perimeterKm !== undefined && <text x={top[0] + 68} y={top[1] - 36}>P {dims.perimeterKm.toFixed(2)} km</text>}
      </g>
    </svg>
  );
}

/** An aligned dimension: extension lines, a dimension line with arrows, the value on it. */
function Aligned({ a, b, offset, label, major }: { a: Pt; b: Pt; offset: number; label: string; major?: boolean }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const sgn = Math.sign(offset) || 1;
  const p1: Pt = [a[0] + nx * offset, a[1] + ny * offset];
  const p2: Pt = [b[0] + nx * offset, b[1] + ny * offset];
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  const mid: Pt = [(p1[0] + p2[0]) / 2 + nx * 9 * sgn, (p1[1] + p2[1]) / 2 + ny * 9 * sgn];
  return (
    <g className={`cad-dim ${major ? 'is-major' : ''}`}>
      <line className="cad-ext" x1={a[0] + nx * 3 * sgn} y1={a[1] + ny * 3 * sgn} x2={p1[0] + nx * 6 * sgn} y2={p1[1] + ny * 6 * sgn} />
      <line className="cad-ext" x1={b[0] + nx * 3 * sgn} y1={b[1] + ny * 3 * sgn} x2={p2[0] + nx * 6 * sgn} y2={p2[1] + ny * 6 * sgn} />
      <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} markerStart="url(#cad-arrow)" markerEnd="url(#cad-arrow)" />
      <text x={mid[0]} y={mid[1]} transform={`rotate(${angle} ${mid[0]} ${mid[1]})`}>{label}</text>
    </g>
  );
}
