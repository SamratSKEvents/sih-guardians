/**
 * Thickness, as colour.
 *
 * The Bonn Agreement appearance code, which is what an aerial observer reports
 * and therefore the only scale a responder already knows how to read. The
 * bands are thickness, not concentration, and the boundaries are the
 * agreement's own:
 *
 *   sheen                       0.04 – 0.3 µm
 *   rainbow                     0.3  – 5   µm
 *   metallic                    5    – 50  µm
 *   discontinuous true colour   50   – 200 µm
 *   continuous true colour      > 200 µm
 *
 * Below the sheen floor there is nothing to draw: oil thinner than 0.04 µm is
 * not visible on the water either, and painting it would put colour on the map
 * where an observer overhead would see clean sea.
 */

const BANDS: [limitUm: number, r: number, g: number, b: number, a: number][] = [
  [0.3, 170, 186, 200, 90],
  [5, 122, 150, 196, 130],
  [50, 150, 140, 160, 170],
  [200, 150, 106, 66, 205],
  [Infinity, 92, 58, 33, 235],
];

/** The Bonn band a thickness falls in, as RGBA. */
export function bandOf(micron: number): [number, number, number, number] {
  for (const [limit, r, g, b, a] of BANDS) if (micron < limit) return [r, g, b, a];
  return [92, 58, 33, 235];
}

const SHEEN_FLOOR_UM = 0.04;

/** Upper edge of each band, µm, in legend order. */
export const BAND_LIMITS_UM = BANDS.map(([limit]) => limit);

/*
 * A frame travels as one byte per cell: 0 is clean water, 1–255 a log scale
 * from the sheen floor to 1 mm. A quarter of RGBA, which is what lets a
 * twelve-hour run keep every frame for scrubbing; the colour is applied on the
 * way to the GPU through the table below.
 */
const LOG_MIN = Math.log10(SHEEN_FLOOR_UM * 1e-6);
const LOG_SPAN = Math.log10(1e-3) - LOG_MIN;

export function encodeThickness(metres: number): number {
  if (!(metres * 1e6 >= SHEEN_FLOOR_UM)) return 0; // transparent: clean water
  return 1 + Math.min(254, Math.round((254 * (Math.log10(metres) - LOG_MIN)) / LOG_SPAN));
}

/** Code → RGBA, 256 entries. */
export const CODE_RGBA: Uint8Array = (() => {
  const table = new Uint8Array(256 * 4);
  for (let code = 1; code < 256; code++) {
    const micron = 10 ** (LOG_MIN + ((code - 1) / 254) * LOG_SPAN) * 1e6;
    table.set(bandOf(micron), code * 4);
  }
  return table;
})();

/** The legend, in the order the bands stack. */
export const BONN_LEGEND: { label: string; range: string; css: string }[] = [
  { label: 'Sheen', range: '0.04–0.3 µm', css: 'rgb(170 186 200)' },
  { label: 'Rainbow', range: '0.3–5 µm', css: 'rgb(122 150 196)' },
  { label: 'Metallic', range: '5–50 µm', css: 'rgb(150 140 160)' },
  { label: 'True colour, discontinuous', range: '50–200 µm', css: 'rgb(150 106 66)' },
  { label: 'True colour, continuous', range: '> 200 µm', css: 'rgb(92 58 33)' },
];
