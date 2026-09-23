import { DEMO_SLICKS } from '../../api/slicks';
import type { LonLat } from '../../incidents/types';

const VESSEL_COUNTS = [2, 1, 3, 0, 1, 2, 3, 1, 0, 2, 1, 3, 0, 2, 1, 3, 0, 2, 1, 0] as const;
const VESSEL_PROFILES = [
  { name: 'MT Blue Horizon', type: 'Tanker', speedKn: 11.2, tone: 'source' as const },
  { name: 'MV Eastern Star', type: 'Container', speedKn: 13.6, tone: 'forecast' as const },
  { name: 'MV Coastal Trader', type: 'Bulk carrier', speedKn: 10.1, tone: 'slick' as const },
];

function offset(lon: number, lat: number, eastKm: number, northKm: number): LonLat {
  return { lon: lon + eastKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2)), lat: lat + northKm / 110.57 };
}

/** Deterministic mock AIS tracks: steady shipping lanes with gradual course corrections. */
export function scenarioVessels(slickId: string, centre: LonLat) {
  const slickIndex = Math.max(0, DEMO_SLICKS.findIndex((item) => item.id === slickId));
  const count = VESSEL_COUNTS[slickIndex % VESSEL_COUNTS.length];
  const baseHeading = slickIndex % 2 === 0 ? 0 : 180;

  return Array.from({ length: count }, (_, vesselIndex) => {
    const profile = VESSEL_PROFILES[vesselIndex];
    const heading = (baseHeading + (vesselIndex === 2 ? 14 : vesselIndex === 1 ? -5 : 0) + 360) % 360;
    const distanceKm = [6.5, 13.5, 21][vesselIndex];
    const bearingToVessel = [72, 246, 118][(slickIndex + vesselIndex) % 3] * (Math.PI / 180);
    const east = Math.sin(bearingToVessel) * distanceKm;
    const north = Math.cos(bearingToVessel) * distanceKm;
    const routeAngle = heading * (Math.PI / 180);
    const alongEast = Math.sin(routeAngle);
    const alongNorth = Math.cos(routeAngle);
    const crossEast = Math.cos(routeAngle);
    const crossNorth = -Math.sin(routeAngle);
    const course = [-36, -18, 0, 18, 36].map((along, pointIndex) => {
      const lateral = [0, 0, 0, 0.8, 1.8][pointIndex];
      return offset(
        centre.lon,
        centre.lat,
        east + along * alongEast + lateral * crossEast,
        north + along * alongNorth + lateral * crossNorth,
      );
    });

    return { ...profile, at: offset(centre.lon, centre.lat, east, north), course, courseDeg: heading, distanceKm };
  });
}
