/**
 * Copies the Cesium runtime assets Vite cannot bundle into public/.
 *
 * Only the folders this app actually reaches for are copied. The full
 * Build/Cesium dump is ~7.7 MB, and most of it is imagery, map pins and lens
 * flares for features we do not enable.
 */

import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cesium = resolve(root, 'node_modules/cesium/Build/Cesium');
const out = resolve(root, 'public/cesium');

// Workers/ThirdParty are fetched at runtime by URL; SkyBox is the star field;
// Images holds credit logos; approximateTerrainHeights is needed the moment any
// future layer clamps geometry to the ground.
const needed = [
  'Workers',
  'ThirdParty',
  'Assets/Images',
  'Assets/Textures/SkyBox',
  'Assets/Textures/NaturalEarthII',
  'Assets/approximateTerrainHeights.json',
];

await mkdir(out, { recursive: true });
for (const item of needed) {
  await mkdir(dirname(resolve(out, item)), { recursive: true });
  await cp(resolve(cesium, item), resolve(out, item), { recursive: true });
}
