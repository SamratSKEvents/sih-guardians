/**
 * The ships the Spills map shows: for each of the 20 demo slicks, the same
 * vessel list its investigation's Map page uses — the incident's AIS bundle
 * where one exists (Gulf of Kutch), the coast-aware traffic picture otherwise —
 * cut to its top-ranked suspects. Times are absolute (ms), not hours from T0.
 *
 * Computing it runs the vessel generator against the high-res coast for all
 * 20 slicks: ~25 s of CPU. So it is done once by tools/slick-vessels.mjs into
 * public/data/slick-vessels.json, and the map only loads that file.
 */

import { DEMO_SLICKS } from '../api/slicks';
import { resolveIncidentId } from '../api/incidents';
import { loadLandRings } from '../forecast/land';
import { carryToPass, fromBundle, generate, indexLand, type MapVessel, type Pt } from '../surfaces/investigate/stages/mapData';

/** Suspects per slick; the rest of the traffic stays in the investigation. */
const PER_SLICK = 5;

export interface SlickVessel {
  slickId: string;
  vessel: MapVessel;
  /** [ms, lon, lat], oldest first. */
  track: [number, number, number][];
}

const json = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);

let cache: Promise<SlickVessel[]> | undefined;

/** The precomputed ships (see tools/slick-vessels.mjs). */
export function loadSlickVessels(): Promise<SlickVessel[]> {
  cache ??= json(`${import.meta.env.BASE_URL}data/slick-vessels.json`).then((list) => list ?? []);
  return cache;
}

/** The expensive build. Only the tool calls this. */
export function computeSlickVessels(): Promise<SlickVessel[]> {
  return (async () => {
    const rings = (await loadLandRings().catch(() => [])) as Pt[][];
    const out: SlickVessel[] = [];
    const seen = new Set<string>();
    for (const slick of DEMO_SLICKS) {
      const centre = slick.properties.centroid as Pt;
      const land = indexLand(rings.filter((r) => r.some(([x, y]) => Math.abs(x - centre[0]) < 3 && Math.abs(y - centre[1]) < 3)));
      const id = resolveIncidentId(slick);
      const base = id ? `${import.meta.env.BASE_URL}data/incidents/${id}` : undefined;
      const [incident, ais, cands] = base
        ? await Promise.all([json(`${base}/incident.json`), json(`${base}/ais.json`), json(`${base}/candidates.json`)])
        : [];
      const t0 = incident?.acquisitionTime ? Date.parse(incident.acquisitionTime) : Date.parse(slick.properties.observedAt);
      const list = ais?.tracks?.length ? carryToPass(fromBundle(ais, cands, t0, centre), land) : generate(slick.id, centre, land);
      const top = list
        .filter((v) => v.rank !== undefined && v.points.length > 1)
        .sort((a, b) => a.rank! - b.rank!)
        .slice(0, PER_SLICK);
      for (const vessel of top) {
        if (seen.has(vessel.mmsi)) continue; // entity ids are keyed by MMSI
        seen.add(vessel.mmsi);
        out.push({ slickId: slick.id, vessel, track: vessel.points.map((p) => [t0 + p.t * 3_600_000, p.lon, p.lat]) });
      }
    }
    return out;
  })();
}
