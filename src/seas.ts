/**
 * The name of the water a detection sits in.
 *
 * A record carries a centroid and nothing that names a place, so a card
 * titled by the record alone can only ever say its category. An operator does
 * not hold "34.6099 N, 31.4521 E" in their head; they hold "off Cyprus". This
 * turns the one into the other.
 *
 * A bounding box per sea, most specific first, so the Alboran Sea wins over
 * the Mediterranean that contains it. Boxes are deliberately coarse: this
 * names the body of water for a human reading a title, and is never used to
 * decide anything. Nothing here is a jurisdiction, a boundary or a claim.
 *
 * Open water falls back to the ocean and hemisphere, which always yields a
 * name, so a title never has a hole in it.
 */

/** name, west, south, east, north */
type Box = readonly [string, number, number, number, number];

const SEAS: readonly Box[] = [
  // Mediterranean and its named basins, finest first.
  ['Alboran Sea', -5.6, 35, -1, 37],
  ['Adriatic Sea', 12, 39.5, 20, 46],
  ['Aegean Sea', 22.5, 35, 28, 41],
  ['Ionian Sea', 15, 34.5, 22.5, 40],
  ['Tyrrhenian Sea', 9, 37.5, 16, 44],
  ['Ligurian Sea', 7, 43, 10.5, 44.5],
  ['Gulf of Sidra', 15, 29, 21, 33],
  ['Levantine Sea', 28, 30, 36.5, 37],
  ['Mediterranean', -6, 30, 36.5, 46],
  ['Sea of Marmara', 26, 40, 30, 41.5],
  ['Black Sea', 27, 40, 42, 47.5],
  ['Caspian Sea', 46, 36, 55, 47],

  // Red Sea, Gulf, Arabian Sea.
  ['Gulf of Suez', 32, 27, 35, 30],
  ['Red Sea', 32, 12, 44, 30],
  ['Gulf of Aden', 43, 10, 52, 15],
  ['Persian Gulf', 47, 23, 57, 31],
  ['Gulf of Oman', 56, 22, 62, 27],
  ['Arabian Sea', 52, 5, 75, 25],

  // South and East Asia.
  ['Bay of Bengal', 78, 5, 95, 23],
  ['Andaman Sea', 92, 5, 99, 17],
  ['Strait of Malacca', 95, 0, 104, 7],
  ['Gulf of Thailand', 99, 5, 105, 14],
  ['South China Sea', 99, -3, 121, 23],
  ['Java Sea', 105, -7, 117, -2],
  ['Yellow Sea', 117, 33, 127, 41],
  ['East China Sea', 117, 23, 131, 33],
  ['Sea of Japan', 127, 33, 142, 52],
  ['Sea of Okhotsk', 135, 45, 163, 60],

  // Atlantic margins.
  ['English Channel', -5, 48.5, 2, 51],
  ['North Sea', -4, 51, 9, 61],
  ['Baltic Sea', 9, 53, 30, 66],
  ['Bay of Biscay', -10, 43.5, -1, 48.5],
  ['Norwegian Sea', -5, 62, 20, 70],
  ['Barents Sea', 20, 68, 60, 80],
  ['Gulf of Mexico', -98, 18, -81, 31],
  ['Caribbean', -88, 8, -59, 23],
  ['Gulf of Guinea', -5, -5, 9, 6],
  ['Gulf of California', -115, 22, -107, 32],

  // Southern and Pacific margins.
  ['Mozambique Channel', 34, -26, 49, -10],
  ['Coral Sea', 142, -25, 165, -10],
  ['Tasman Sea', 147, -45, 175, -30],
  ['Great Australian Bight', 115, -40, 140, -30],
];

/** The ocean a point sits in, so open water still gets a name. */
function ocean(lon: number, lat: number): string {
  if (lat > 66) return 'Arctic Ocean';
  if (lat < -60) return 'Southern Ocean';
  if (lon >= -70 && lon <= 20) return lat >= 0 ? 'North Atlantic' : 'South Atlantic';
  if (lon > 20 && lon <= 147) return 'Indian Ocean';
  return lat >= 0 ? 'North Pacific' : 'South Pacific';
}

/**
 * `[lon, lat]` to the water it names. Undefined only when there is no
 * centroid, so a caller can leave the place out rather than print a guess.
 */
export function seaName(centroid: unknown): string | undefined {
  if (!Array.isArray(centroid)) return undefined;
  const [lon, lat] = centroid;
  if (typeof lon !== 'number' || typeof lat !== 'number') return undefined;
  const hit = SEAS.find(([, w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
  return hit ? hit[0] : ocean(lon, lat);
}
