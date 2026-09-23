/** The first stop in an investigation: what the radar actually recorded. */

import {
  Activity,
  Check,
  CircleAlert,
  Crosshair,
  Database,
  FileText,
  Map as MapIcon,
  Ruler,
  Satellite,
  Ship,
  Triangle,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Notice } from '../../../design/components';
import type { StageProps } from '../Workspace';
import type { Detection, LonLat, SarImagery } from '../../../incidents/types';
import { fetchDetection } from '../../../api/incidents';
import { fetchScene } from '../../../api/scenes';
import { useArtifact } from '../../../incidents/useArtifact';
import { GEOMETRY_LABEL, say } from '../../../incidents/words';
import { CesiumChart } from '../CesiumChart';
import { extentOf, type MapImage, type MapLayer } from '../chart-types';
import { km, km2, latLon, when } from '../../../format';
import { principalAxis, ringsOf } from '../geometry';
import { StageFrame } from '../StageFrame';
import { scenarioVessels } from '../mockVessels';

const MOCK_SCORES = [
  { label: 'Oil slick', value: 0.78, tone: 'is-best' },
  { label: 'Ship wake', value: 0.34, tone: '' },
  { label: 'Biogenic film', value: 0.28, tone: '' },
  { label: 'Wind shadow', value: 0.21, tone: '' },
];

function Card({ title, icon, children, className = '' }: { title: string; icon: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`detect-card ${className}`}>
      <h3>{icon}<span>{title}</span></h3>
      {children}
    </section>
  );
}

function Rows({ children }: { children: React.ReactNode }) {
  return <dl className="detect-rows">{children}</dl>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function offset(lon: number, lat: number, eastKm: number, northKm: number): LonLat {
  return { lon: lon + eastKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2)), lat: lat + northKm / 110.57 };
}

export function mockSarImage(slickId: string, rings: number[][][]): MapImage | undefined {
  if (typeof document === 'undefined' || rings.length === 0) return undefined;
  const points = rings.flat();
  const west = Math.min(...points.map(([lon]) => lon));
  const east = Math.max(...points.map(([lon]) => lon));
  const south = Math.min(...points.map(([, lat]) => lat));
  const north = Math.max(...points.map(([, lat]) => lat));
  const padX = Math.max((east - west) * 0.42, 0.012);
  const padY = Math.max((north - south) * 0.42, 0.012);
  const extent: [number, number, number, number] = [west - padX, south - padY, east + padX, north + padY];
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return undefined;

  let seed = 0;
  for (const character of slickId) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const image = context.createImageData(size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const speckle = 105 + Math.floor(random() * 105);
    image.data[i] = Math.max(0, speckle - 8);
    image.data[i + 1] = speckle + 8;
    image.data[i + 2] = speckle + 13;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  // The synthetic backscatter feature follows the actual demo outline; the
  // bright CAD-style vector remains a separate, readable overlay on top.
  context.beginPath();
  for (const ring of rings) {
    ring.forEach(([lon, lat], index) => {
      const x = ((lon - extent[0]) / (extent[2] - extent[0])) * size;
      const y = ((extent[3] - lat) / (extent[3] - extent[1])) * size;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
  }
  context.fillStyle = 'rgba(18, 31, 28, 0.82)';
  context.fill('evenodd');

  return { id: 'sar', label: 'Synthetic SAR preview', url: canvas.toDataURL('image/png'), extent };
}

export function DetectionStage({ slick, incident, incidentId, detectionPanel }: StageProps) {
  const [viewMode, setViewMode] = useState<'source' | 'map'>(detectionPanel === 'vessels' ? 'map' : 'source');
  useEffect(() => setViewMode(detectionPanel === 'vessels' ? 'map' : 'source'), [slick.id, detectionPanel]);
  const detection = useArtifact<Detection>(incidentId, fetchDetection);
  const bundled = detection && detection !== 'error' ? detection.sarImagery : undefined;
  const sceneId = typeof slick.properties.scene === 'string' ? slick.properties.scene : undefined;
  const askCatalog = bundled?.status !== 'AVAILABLE' && sceneId !== undefined;
  const catalog = useArtifact<SarImagery>(askCatalog ? sceneId : undefined, fetchScene);
  const sar = bundled?.status === 'AVAILABLE' ? bundled : catalog === 'error' ? bundled : (catalog ?? bundled);
  const p = slick.properties;
  const rings = ringsOf(slick.geometry);
  const centreValue = Array.isArray(p.centroid) ? p.centroid : undefined;
  const centre = centreValue && typeof centreValue[0] === 'number' && typeof centreValue[1] === 'number'
    ? { lon: centreValue[0], lat: centreValue[1] }
    : incident?.centre;
  const axis = principalAxis(rings, centre);
  const observedAt = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(p.observedAt);
  const outline: LonLat[] = rings.flat().map(([lon, lat]) => ({ lon, lat }));
  const mockImage = useMemo(() => mockSarImage(slick.id, rings), [slick.id]);
  const sourceImage: MapImage | undefined = sar?.status === 'AVAILABLE' && sar.url && sar.bounds
    ? { id: 'sar', label: `SAR scene - ${sar.band?.split(' ')[0] ?? 'VV'}`, url: sar.url, extent: sar.bounds }
    : mockImage;
  const demoVessels = centre ? scenarioVessels(slick.id, centre) : [];

  const extraPoints = detectionPanel === 'vessels'
    ? demoVessels.flatMap((vessel) => vessel.course)
    : detectionPanel === 'lookalike' && centre
      ? [offset(centre.lon, centre.lat, -7, 4), offset(centre.lon, centre.lat, 8, 4), offset(centre.lon, centre.lat, 9, -8)]
      : [];
  const imagePoints: LonLat[] = viewMode === 'source' && sourceImage ? [
    { lon: sourceImage.extent[0], lat: sourceImage.extent[1] },
    { lon: sourceImage.extent[2], lat: sourceImage.extent[3] },
  ] : [];
  const extent = extentOf([...outline, ...extraPoints, ...imagePoints, ...(centre ? [centre] : [])], centre ?? { lon: 0, lat: 0 }, detectionPanel === 'vessels' ? 0.22 : 0.05);

  const layers: MapLayer[] = [];
  if (rings.length > 0) layers.push({ id: 'outline', label: 'Slick geometry', claim: 'observed', shapes: [{ kind: 'polygon', rings }] });
  if (centre) {
    layers.push({ id: 'centroid', label: 'Feature centre', claim: 'observed', shapes: [{ kind: 'point', at: centre, tone: 'select', radius: 7 }] });
    if (axis && ['geometry', 'overview', 'provenance'].includes(detectionPanel)) {
      layers.push({
        id: 'dimensions', label: 'Major and minor axis', claim: 'reconstructed',
        shapes: [
          { kind: 'dimension', at: centre, bearingDeg: axis.bearingDeg, lengthKm: axis.lengthKm, label: `${km(axis.lengthKm * 1000)} (major axis)`, tone: 'select' },
          { kind: 'dimension', at: centre, bearingDeg: (axis.bearingDeg + 90) % 180, lengthKm: axis.widthKm, label: `${km(axis.widthKm * 1000)} (minor axis)`, tone: 'source' },
        ],
      });
    }
    if (detectionPanel === 'vessels') {
      layers.push({
        id: 'vessels', label: 'Scenario vessel tracks', claim: 'reconstructed',
        shapes: demoVessels.flatMap((vessel) => [
          { kind: 'path' as const, points: vessel.course, tone: vessel.tone, width: 3 },
          { kind: 'point' as const, at: vessel.at, tone: vessel.tone, radius: 7, label: vessel.name },
        ]),
      });
    }
    if (detectionPanel === 'lookalike') {
      layers.push({
        id: 'lookalikes', label: 'Illustrative look-alikes', claim: 'reconstructed',
        shapes: [
          { kind: 'point', at: offset(centre.lon, centre.lat, -7, 4), tone: 'muted', radius: 4, label: 'Wind shadow' },
          { kind: 'point', at: offset(centre.lon, centre.lat, 8, 4), tone: 'muted', radius: 4, label: 'Ship wake' },
          { kind: 'point', at: offset(centre.lon, centre.lat, 9, -8), tone: 'muted', radius: 4, label: 'Biogenic film' },
        ],
      });
    }
  }

  const image = viewMode === 'source' ? sourceImage : undefined;
  const sourceLabel = incident?.sensor ?? p.sensor ?? 'Sentinel-1 SAR';
  const probability = typeof p.probability === 'number' ? p.probability : 0.78;
  const lookalike = p.lookalikeWarning === true;
  const geometry = say(GEOMETRY_LABEL, String(p.geometryKind ?? '')) ?? 'Polygon';

  return (
    <StageFrame chart={
      <CesiumChart
        extent={extent}
        layers={layers}
        image={image}
        overlay={(
          <div className="detect-view-toggle" role="group" aria-label="Detection view">
            <button type="button" aria-pressed={viewMode === 'map'} onClick={() => setViewMode('map')}>
              <MapIcon size={15} />Map
            </button>
            <button type="button" aria-pressed={viewMode === 'source'} onClick={() => setViewMode('source')}>
              <Satellite size={15} />Source image{sourceImage?.label === 'Synthetic SAR preview' && <small>DEMO</small>}
            </button>
          </div>
        )}
        caption={`${when.format(observedAt)} UTC | ${String(sourceLabel)}`}
      />
    }>
      <div className="detect-pane">
        {detectionPanel === 'overview' && (
          <>
            <div className="detect-result">
              <span className="detect-result-icon"><CircleAlert size={19} /></span>
              <div><h2>Possible slick detected</h2><p>A dark radar feature is present. Its composition needs corroboration.</p></div>
            </div>
            <Card title="Detection summary" icon={<Activity size={16} />}>
              <Rows>
                <Row label="Detection confidence">{probability.toFixed(2)} <small>dark feature score</small></Row>
                <Row label="Second opinion">{String(p.verifier ?? 'Not available')}</Row>
                <Row label="Look-alike flag">{lookalike ? 'Review recommended' : 'No flag recorded'}</Row>
              </Rows>
            </Card>
            <Card title="Observation" icon={<Crosshair size={16} />}>
              <Rows><Row label="Observed">{when.format(observedAt)} UTC</Row><Row label="Sensor">{String(sourceLabel)}</Row><Row label="Scene">{String(p.scene ?? '—')}</Row></Rows>
            </Card>
          </>
        )}

        {detectionPanel === 'geometry' && (
          <>
            <div className={`detect-result ${lookalike ? 'is-watch' : ''}`}>
              <span className="detect-result-icon">{lookalike ? <CircleAlert size={19} /> : <Check size={19} />}</span>
              <div><h2>{lookalike ? 'Review this detection' : 'Possible slick detected'}</h2><p>{lookalike ? 'A second model flagged a possible look-alike.' : 'A coherent dark feature has been identified and delineated.'}</p></div>
            </div>
            <Card title="Geometry" icon={<Ruler size={16} />}>
              <Rows>
                <Row label="Area">{km2(p.areaM2)}</Row>
                <Row label="Length (major axis)">{axis ? km(axis.lengthKm * 1000) : km(p.lengthM)}</Row>
                {axis && <Row label="Width (minor axis)">{km(axis.widthKm * 1000)}</Row>}
                {axis && <Row label="Aspect ratio">{(axis.lengthKm / axis.widthKm).toFixed(1)} : 1</Row>}
                {axis && <Row label="Orientation">{axis.bearingDeg.toFixed(0)}° true</Row>}
                <Row label="Centroid">{latLon(p.centroid)}</Row>
              </Rows>
            </Card>
            <Card title="Shape characteristics" icon={<Triangle size={16} />}>
              <Rows>
                <Row label="Shape">{geometry}</Row>
                <Row label="Perimeter">{typeof p.perimeterM === 'number' ? km(p.perimeterM) : 'Illustrative'}</Row>
                <Row label="Geometry source">{String(p.geometrySource ?? 'Model segmentation')}</Row>
              </Rows>
            </Card>
            <Card title="Detection details" icon={<Crosshair size={16} />}>
              <Rows>
                <Row label="Acquired">{when.format(observedAt)} UTC</Row>
                <Row label="Sensor">{String(sourceLabel)}</Row>
                <Row label="Scene">{String(p.scene ?? '—')}</Row>
                <Row label="Polarization">{String(p.polarization ?? 'VV')}</Row>
                <Row label="Detection method">{String(p.detector ?? 'Dark-feature segmentation')}</Row>
                <Row label="Confidence"><span className="detect-score"><i style={{ width: `${Math.round(probability * 100)}%` }} />{probability.toFixed(2)}</span></Row>
              </Rows>
            </Card>
          </>
        )}

        {detectionPanel === 'lookalike' && (
          <>
            <div className="detect-result"><span className="detect-result-icon"><CircleAlert size={19} /></span><div><h2>Classification hypothesis</h2><p>Illustrative comparison scores for the demo feature.</p></div></div>
            <Card title="Look-alike scorecard" icon={<Activity size={16} />}>
              <div className="detect-score-list">{MOCK_SCORES.map((item) => <div key={item.label}><span>{item.label}</span><i><b className={item.tone} style={{ width: `${item.value * 100}%` }} /></i><strong>{item.value.toFixed(2)}</strong></div>)}</div>
            </Card>
            <Card title="Evidence for a slick" icon={<Check size={16} />}>
              <ul className="detect-evidence is-for"><li>Dark, coherent backscatter feature</li><li>Elongated outline in the scene</li><li>Geometry is available for review</li></ul>
            </Card>
            <Card title="Evidence against / unknown" icon={<X size={16} />}>
              <ul className="detect-evidence is-against"><li>Single polarization; no polarimetric confirmation</li><li>Wind and current context is not bundled</li><li>Comparison scores are illustrative demo data</li></ul>
            </Card>
            <Card title="Recommended next checks" icon={<Crosshair size={16} />}>
              <ol className="detect-next"><li>Check nearby vessels around the observation time</li><li>Compare another acquisition if available</li><li>Review local wind and surface conditions</li></ol>
            </Card>
          </>
        )}

        {detectionPanel === 'vessels' && (
          <>
            <div className="detect-result"><span className="detect-result-icon"><Ship size={19} /></span><div><h2>Vessel context</h2><p>Routes shown with ship positions at the image capture time.</p></div></div>
            <Card title="AIS scenario - demo" icon={<Activity size={16} />}>
              <Rows><Row label="Nearby vessels">{demoVessels.length} <small>mock</small></Row><Row label="Track points">{demoVessels.length * 5}</Row><Row label="Scenario time">{when.format(observedAt)} UTC</Row></Rows>
            </Card>
            <Card title="Nearby vessels" icon={<Ship size={16} />}>
              {demoVessels.length > 0 ? <div className="detect-vessels">{demoVessels.map((vessel, i) => <div key={vessel.name}><span className={`detect-vessel-mark tone-${i}`}><Ship size={14} /></span><span><b>{vessel.name}</b><small>{vessel.type} · {vessel.speedKn.toFixed(1)} kn · {vessel.courseDeg}°</small></span><strong>{vessel.distanceKm.toFixed(1)} km</strong></div>)}</div> : <p className="detect-copy">No vessels are included in this slick’s mock traffic scenario.</p>}
            </Card>
            <Card title="Candidate vessel" icon={<Crosshair size={16} />}>
              {demoVessels.length > 0 ? <Rows><Row label="Closest vessel">{[...demoVessels].sort((a, b) => a.distanceKm - b.distanceKm)[0].name}</Row><Row label="Track consistency">0.87 <small>illustrative</small></Row><Row label="Association">Candidate only</Row></Rows> : <p className="detect-copy">No candidate is assigned for this scenario.</p>}
              <p className="detect-copy">Names, positions and scores are illustrative only; they do not identify a real source.</p>
            </Card>
          </>
        )}

        {detectionPanel === 'provenance' && (
          <>
            <div className="detect-result"><span className="detect-result-icon"><Database size={19} /></span><div><h2>Data lineage & provenance</h2><p>{incident ? 'Incident bundle records are shown below.' : 'Illustrative processing chain for this demo record.'}</p></div></div>
            <Card title="Observation source" icon={<Crosshair size={16} />}>
              <Rows><Row label="Mission">{String(incident?.sensor ?? 'Sentinel-1 SAR')}</Row><Row label="Acquisition time">{when.format(observedAt)} UTC</Row><Row label="Polarization">{String(p.polarization ?? 'VV (inferred)')}</Row><Row label="Scene ID">{String(p.scene ?? '-')}</Row><Row label="Provider">Copernicus / ESA - demo record</Row></Rows>
            </Card>
            <Card title="Processing chain" icon={<Activity size={16} />}>
              <ol className="detect-chain"><li><b>Source data</b><span>SAR observation · static demo catalog</span></li><li><b>Pre-processing</b><span>Calibration and speckle reduction · illustrative</span></li><li><b>Dark feature detection</b><span>{String(p.detector ?? 'Model segmentation')}</span></li><li><b>Reviewed geometry</b><span>{geometry} · {km2(p.areaM2)}</span></li></ol>
            </Card>
            <Card title="Quality checks" icon={<Check size={16} />}>
              <ul className="detect-checks"><li><Check size={14} />Geometry is present</li><li><Check size={14} />Observation time is available</li><li><CircleAlert size={14} />Human review is not recorded</li></ul>
            </Card>
            <Card title="Data limits" icon={<FileText size={16} />}>
              <p className="detect-copy">The catalog carries 20 static slick records. Processing details not present in a record are shown as mock demo data and should not be treated as verified provenance.</p>
            </Card>
          </>
        )}

        {sar && sar.status !== 'AVAILABLE' && detectionPanel === 'geometry' && sar.detail && (
          <Notice status="watch" title="No scene image bundled">{sar.detail}</Notice>
        )}
        {rings.length === 0 && <Notice status="watch" title="No outline was recovered">This record has a position but no polygon geometry.</Notice>}
      </div>
    </StageFrame>
  );
}
