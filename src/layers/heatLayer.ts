/**
 * Slick density: where detections concentrate.
 *
 * Every slick centroid (demo + catalogue) is splatted as a soft disc into an
 * equirectangular canvas, additively, then coloured on a log scale (a few
 * hotspots hold thousands, most cells one or two, so linear would show three
 * dots). The canvas is one textured rectangle just above the globe: above any
 * basemap, untouched by imagery adjustments, and never picked, so clicks still
 * reach the slicks.
 */

import { GeometryInstance, Material, MaterialAppearance, Primitive, Rectangle, RectangleGeometry } from 'cesium';
import { fetchSlickPositions } from '../api/slicks';
import type { MapLayerDefinition } from './types';

const W = 2048;
const H = 1024;
/** Splat radius in canvas px (~2.5° at this width): regional hotspots, not single slicks. */
const R = 14;

/** Transparent → deep blue → cyan → yellow → red, by density 0..1. */
const STOPS: [number, [number, number, number, number]][] = [
  [0, [0, 0, 0, 0]],
  [0.05, [40, 80, 220, 150]],
  [0.3, [0, 200, 230, 195]],
  [0.6, [255, 220, 0, 215]],
  [1, [255, 40, 20, 235]],
];

function ramp(v: number): [number, number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    const [b, cb] = STOPS[i];
    if (v <= b) {
      const [a, ca] = STOPS[i - 1];
      const k = (v - a) / (b - a);
      return ca.map((c, j) => Math.round(c + (cb[j] - c) * k)) as [number, number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

function paint(points: [number, number][]): HTMLCanvasElement {
  // Density as float, splatted with a quadratic falloff.
  const d = new Float32Array(W * H);
  for (const [lon, lat] of points) {
    const cx = ((lon + 180) / 360) * W;
    const cy = ((90 - lat) / 180) * H;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const q = 1 - ((x - cx) ** 2 + (y - cy) ** 2) / (R * R);
        if (q > 0) d[y * W + ((x + W) % W)] += q * q;
      }
    }
  }
  let max = 0;
  for (const v of d) max = Math.max(max, v);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(W, H);
  const top = Math.log1p(max || 1);
  for (let i = 0; i < d.length; i++) {
    if (!d[i]) continue;
    img.data.set(ramp(Math.log1p(d[i]) / top), i * 4);
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

export const heatLayer = {
  id: 'slick-density',
  label: 'Slick density',
  description: 'Heatmap of every slick detection, log-scaled: where spills concentrate.',
  value: 'heat',
  swatch: 'heat',
  defaultVisible: false,
  create({ viewer }) {
    let visible = false;
    let primitive: Primitive | undefined;
    let destroyed = false;
    let started = false;

    // Built on first show: no reason to pay for 13k splats if nobody turns it on.
    const build = () => {
      started = true;
      fetchSlickPositions().then((points) => {
        if (destroyed) return;
        primitive = new Primitive({
          geometryInstances: new GeometryInstance({
            geometry: new RectangleGeometry({
              rectangle: Rectangle.fromDegrees(-180, -90, 180, 90),
              height: 200,
              vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat,
            }),
          }),
          appearance: new MaterialAppearance({
            material: Material.fromType('Image', { image: paint(points) }),
            materialSupport: MaterialAppearance.MaterialSupport.TEXTURED,
            translucent: true,
          }),
          allowPicking: false,
          show: visible,
        });
        viewer.scene.primitives.add(primitive);
        viewer.scene.requestRender();
      });
    };

    return {
      setVisible(show) {
        visible = show;
        if (show && !started) build();
        if (primitive) primitive.show = show;
        viewer.scene.requestRender();
      },
      destroy() {
        destroyed = true;
        if (primitive) viewer.scene.primitives.remove(primitive);
      },
    };
  },
} satisfies MapLayerDefinition;
