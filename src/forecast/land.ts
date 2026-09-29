type LonLat = [number, number];

interface Topology {
  type: 'Topology';
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, TopologyObject>;
}

type TopologyObject =
  | { type: 'GeometryCollection'; geometries: TopologyObject[] }
  | { type: 'Polygon'; arcs: number[][] }
  | { type: 'MultiPolygon'; arcs: number[][][] };

// 1:50m Natural Earth land (world-atlas@2), served from public/ so a run never waits on a CDN.
const LAND_URL = `${import.meta.env.BASE_URL}data/land-50m.json`;

function decodeArcs(topology: Topology) {
  const scale = topology.transform?.scale ?? [1, 1];
  const translate = topology.transform?.translate ?? [0, 0];
  return topology.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as LonLat;
    });
  });
}

function arc(rings: number[], arcs: LonLat[][]): LonLat[] {
  const points: LonLat[] = [];
  for (const ref of rings) {
    const source = arcs[ref >= 0 ? ref : ~ref];
    if (!source) continue;
    const part = ref >= 0 ? source : [...source].reverse();
    points.push(...(points.length ? part.slice(1) : part));
  }
  return points;
}

function collect(object: TopologyObject, arcs: LonLat[][], out: LonLat[][]) {
  if (object.type === 'GeometryCollection') {
    for (const child of object.geometries) collect(child, arcs, out);
  } else if (object.type === 'Polygon') {
    for (const ring of object.arcs) {
      const decoded = arc(ring, arcs);
      if (decoded.length >= 3) out.push(decoded);
    }
  } else {
    for (const polygon of object.arcs) for (const ring of polygon) {
      const decoded = arc(ring, arcs);
      if (decoded.length >= 3) out.push(decoded);
    }
  }
}

/**
 * OpenStreetMap coastline (as land polygons) around every catalogue slick, and
 * 1:50m Natural Earth land elsewhere, built by tools/coast/. Metre-scale
 * shorelines where the slicks are, so oil stops at the real coast rather than
 * at a coastline generalised by kilometres.
 */
const HIRES_URL = `${import.meta.env.BASE_URL}data/land-hires.json`;

let cache: Promise<LonLat[][]> | undefined;

async function loadCoarse(): Promise<LonLat[][]> {
  const response = await fetch(LAND_URL);
  if (!response.ok) throw new Error(`Shoreline data request failed (${response.status}).`);
  const topology = await response.json() as Topology;
  const object = topology.objects.land ?? Object.values(topology.objects)[0];
  if (!object) throw new Error('Shoreline data has no land object.');
  const rings: LonLat[][] = [];
  collect(object, decodeArcs(topology), rings);
  return rings;
}

export function loadLandRings(): Promise<LonLat[][]> {
  cache ??= fetch(HIRES_URL)
    .then((r) => (r.ok ? r.json() as Promise<{ rings: LonLat[][] }> : Promise.reject(new Error(String(r.status)))))
    .then((d) => d.rings)
    .catch(() => loadCoarse());
  return cache;
}
