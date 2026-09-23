import { describe, expect, it } from 'vitest';
import land from '../public/data/land-50m.json';
import { DEMO_SLICKS } from '../src/api/slicks';
import { HOURS } from '../src/forecast/context';
import { scenarioVessels } from '../src/surfaces/investigate/mockVessels';

type Point = [number, number];

const decodedCoastArcs: Point[][] = (() => {
  const topology = land as {
    transform: { scale: Point; translate: Point };
    arcs: number[][][];
  };
  return topology.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * topology.transform.scale[0] + topology.transform.translate[0], y * topology.transform.scale[1] + topology.transform.translate[1]];
    });
  });
})();

function pointToSegmentKm(point: Point, start: Point, end: Point) {
  const eastScale = 111.32 * Math.cos((point[1] * Math.PI) / 180);
  const ax = (start[0] - point[0]) * eastScale;
  const ay = (start[1] - point[1]) * 110.57;
  const bx = (end[0] - point[0]) * eastScale;
  const by = (end[1] - point[1]) * 110.57;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(ax + dx * t, ay + dy * t);
}

function distanceToCoastKm(point: Point) {
  let nearest = Number.POSITIVE_INFINITY;
  for (const arc of decodedCoastArcs) {
    let west = Number.POSITIVE_INFINITY;
    let east = Number.NEGATIVE_INFINITY;
    let south = Number.POSITIVE_INFINITY;
    let north = Number.NEGATIVE_INFINITY;
    for (const [lon, lat] of arc) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    if (point[0] < west - 1 || point[0] > east + 1 || point[1] < south - 1 || point[1] > north + 1) continue;
    for (let i = 1; i < arc.length; i++) nearest = Math.min(nearest, pointToSegmentKm(point, arc[i - 1], arc[i]));
  }
  return nearest;
}

describe('static demo data', () => {
  it('contains 20 unique, valid slick geometries', () => {
    expect(DEMO_SLICKS).toHaveLength(20);
    expect(new Set(DEMO_SLICKS.map(({ id }) => id)).size).toBe(20);
    for (const slick of DEMO_SLICKS) {
      expect(slick.geometry).not.toBeNull();
      expect(slick.properties.centroid).toHaveLength(2);
      expect(Number.isFinite(Number(slick.properties.areaM2))).toBe(true);
      expect(slick.geometry?.coordinates.length).toBeGreaterThan(0);
    }
  });

  it('marks the two relocated demo detections as assigned locations', () => {
    for (const id of ['edge:oil_08092', 'edge:oil_08480']) {
      expect(DEMO_SLICKS.find((slick) => slick.id === id)?.properties.locationSource).toBe('ASSIGNED_DEMO');
    }
  });

  it('places at least 70% of slicks within 25 km of the bundled coastline', () => {
    const nearCoast = DEMO_SLICKS.filter((slick) => {
      const [lon, lat] = slick.properties.centroid as Point;
      return distanceToCoastKm([lon, lat]) <= 25;
    });
    expect(nearCoast.length).toBeGreaterThanOrEqual(Math.ceil(DEMO_SLICKS.length * 0.7));
  });
});

describe('mock vessel routes', () => {
  it('varies from no nearby ships to three and keeps each track smooth', () => {
    const counts = DEMO_SLICKS.map((slick) => scenarioVessels(slick.id, { lon: 70, lat: 20 }).length);
    expect(Math.min(...counts)).toBe(0);
    expect(Math.max(...counts)).toBe(3);
    expect(new Set(counts)).toEqual(new Set([0, 1, 2, 3]));

    for (const slick of DEMO_SLICKS) {
      for (const vessel of scenarioVessels(slick.id, { lon: 70, lat: 20 })) {
        expect(vessel.course).toHaveLength(5);
        const stepLengths = vessel.course.slice(1).map((point, index) => {
          const previous = vessel.course[index];
          const eastKm = (point.lon - previous.lon) * 111.32 * Math.cos((point.lat * Math.PI) / 180);
          const northKm = (point.lat - previous.lat) * 110.57;
          return Math.hypot(eastKm, northKm);
        });
        expect(Math.max(...stepLengths) - Math.min(...stepLengths)).toBeLessThan(2.5);
      }
    }
  });
});

describe('forecast horizon', () => {
  it('supports the 6, 12 and 24 hour forecast checkpoints', () => {
    expect(HOURS).toBe(24);
  });
});
