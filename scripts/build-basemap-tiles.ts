/**
 * Builds a Cesium-compatible TMS pyramid from global imagery.
 *
 * Handles sources far too large to hold in memory. NASA's Blue Marble ships as
 * eight 21600x21600 quadrants that together make an 86400x43200 image -- 3.7
 * gigapixels, about 11 GB raw -- so the mosaic is never materialised. Each
 * quadrant is resized and cut independently, which works because a 4x2 grid of
 * 90-degree cells lands exactly on tile boundaries at every level above the
 * first.
 *
 * Usage:
 *   node scripts/build-basemap-tiles.ts <name> <maxLevel> <cols>x<rows> <file...>
 *
 * Files are listed in row-major order: west to east, north to south.
 *
 *   NE2         NaturalEarthII 5 1x1 NE2_HR_LC_SR_W_DR.tif
 *   Blue Marble BlueMarble 7 4x2 A1.jpg B1.jpg C1.jpg D1.jpg A2.jpg B2.jpg C2.jpg D2.jpg
 *
 * Output goes to public/tiles/<name>, served at /tiles/<name>. It is gitignored:
 * rebuild after a fresh clone (the app falls back to Cesium's bundled copy).
 *
 * Blue Marble Next Generation is public domain; NASA asks to be credited as
 * "NASA Earth Observatory".
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// libvips keeps decoded files in an operation cache, which on Windows holds the
// handles open and makes the scratch directory undeletable.
sharp.cache(false);

const TILE = 256;
// Cesium's GeographicTilingScheme: level n is 2^(n+1) tiles across by 2^n down,
// which is why 2:1 global coverage needs no reprojection.
const tilesX = (level: number) => 2 ** (level + 1);
const tilesY = (level: number) => 2 ** level;
// Below this width a level is small enough to assemble whole, which is also the
// only way to cut levels too coarse to align with the source grid.
const ASSEMBLE_BELOW = 8192;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [name, maxLevelArg, grid, ...files] = process.argv.slice(2);

if (!name || !grid || files.length === 0) {
  console.error('usage: node scripts/build-basemap-tiles.ts <name> <maxLevel> <cols>x<rows> <file...>');
  process.exit(1);
}

const maxLevel = Number(maxLevelArg);
const [cols, rows] = grid.split('x').map(Number);
if (files.length !== cols * rows) {
  console.error(`grid ${grid} needs ${cols * rows} files, got ${files.length}`);
  process.exit(1);
}

const out = resolve(root, 'public', 'tiles', name);
const scratch = resolve(root, 'public', 'tiles', `.scratch-${name}`);
await rm(out, { recursive: true, force: true });
await mkdir(scratch, { recursive: true });

const cell = await sharp(files[0], { limitInputPixels: false }).metadata();
const sourceWidth = cell.width! * cols;
const sourceHeight = cell.height! * rows;
console.log(`source ${sourceWidth}x${sourceHeight} from ${files.length} file(s) in a ${grid} grid`);
if (sourceWidth !== sourceHeight * 2) {
  console.warn('warning: assembled source is not 2:1; a geodetic pyramid expects -180..180 / -90..90');
}

let written = 0;
let bytes = 0;

/** Cuts one tile-aligned raster into tiles, given where it sits in the level. */
async function cutTiles(
  file: string,
  level: number,
  width: number,
  height: number,
  tileX0: number,
  tileRow0: number,
) {
  // Read the channel count rather than assuming three. compositing promotes an
  // intermediate to RGBA, and a stride computed from the wrong channel count
  // does not fail -- it silently shears every tile into vertical stripes.
  const channels = (await sharp(file, { limitInputPixels: false }).metadata()).channels!;

  for (let row = 0; row < height / TILE; row += 1) {
    // One strip per tile row, then slice it in memory: re-opening the file for
    // every tile costs far more than the strip does.
    const strip = await sharp(file, { limitInputPixels: false })
      .extract({ left: 0, top: row * TILE, width, height: TILE })
      .raw()
      .toBuffer();

    // TMS counts y from the south; rasters are north-up.
    const y = tilesY(level) - 1 - (tileRow0 + row);

    const jobs: Promise<void>[] = [];
    for (let x = 0; x < width / TILE; x += 1) {
      const tile = Buffer.allocUnsafe(TILE * TILE * channels);
      for (let line = 0; line < TILE; line += 1) {
        const from = (line * width + x * TILE) * channels;
        strip.copy(tile, line * TILE * channels, from, from + TILE * channels);
      }
      const dir = resolve(out, String(level), String(tileX0 + x));
      jobs.push(
        mkdir(dir, { recursive: true })
          .then(() =>
            sharp(tile, { raw: { width: TILE, height: TILE, channels: channels as 1 | 2 | 3 | 4 } })
              .jpeg({ quality: 82, mozjpeg: true })
              .toFile(resolve(dir, `${y}.jpg`)),
          )
          .then((info) => {
            written += 1;
            bytes += info.size;
          }),
      );
    }
    // Drain per strip so a deep level does not queue tens of thousands at once.
    await Promise.all(jobs);
  }
}

for (let level = 0; level <= maxLevel; level += 1) {
  const width = TILE * tilesX(level);
  const height = TILE * tilesY(level);
  if (width > sourceWidth) {
    console.log(`level ${level}: ${width}x${height} exceeds the source; stopping (it would only upsample)`);
    break;
  }

  const aligned = tilesX(level) % cols === 0 && tilesY(level) % rows === 0;

  if (width <= ASSEMBLE_BELOW || !aligned) {
    // Small enough to hold: resize every cell and composite the whole level.
    const cellW = Math.round(width / cols);
    const cellH = Math.round(height / rows);
    const parts = await Promise.all(
      files.map(async (file, index) => ({
        input: await sharp(file, { limitInputPixels: false })
          .resize(cellW, cellH, { kernel: 'lanczos3', fit: 'fill' })
          .png({ compressionLevel: 1 })
          .toBuffer(),
        left: (index % cols) * cellW,
        top: Math.floor(index / cols) * cellH,
      })),
    );
    const levelFile = resolve(scratch, `level-${level}.tif`);
    await sharp({ create: { width, height, channels: 3, background: '#000' } })
      .composite(parts)
      // composite promotes to RGBA; the alpha is meaningless here and doubles
      // the intermediate for nothing.
      .removeAlpha()
      .tiff({ compression: 'deflate', tile: true, tileWidth: TILE, tileHeight: TILE })
      .toFile(levelFile);
    await cutTiles(levelFile, level, width, height, 0, 0);
    await rm(levelFile, { force: true }).catch(() => {});
  } else {
    // Too big to assemble: each cell lands on whole tiles, so cut it in place.
    const cellW = width / cols;
    const cellH = height / rows;
    for (let index = 0; index < files.length; index += 1) {
      const gx = index % cols;
      const gy = Math.floor(index / cols);
      const cellFile = resolve(scratch, `level-${level}-${gx}-${gy}.tif`);
      await sharp(files[index], { limitInputPixels: false })
        .resize(cellW, cellH, { kernel: 'lanczos3', fit: 'fill' })
        .tiff({ compression: 'deflate', tile: true, tileWidth: TILE, tileHeight: TILE })
        .toFile(cellFile);
      await cutTiles(cellFile, level, cellW, cellH, gx * (cellW / TILE), gy * (cellH / TILE));
      await rm(cellFile, { force: true }).catch(() => {});
    }
  }
  console.log(
    `level ${level}: ${width}x${height}, ${tilesX(level) * tilesY(level)} tiles, ${(bytes / 1e6).toFixed(0)} MB cumulative`,
  );
}

const sets = [];
for (let level = 0; level <= maxLevel; level += 1) {
  if (TILE * tilesX(level) > sourceWidth) break;
  sets.push(
    `        <TileSet href="${level}" units-per-pixel="${360 / (TILE * tilesX(level))}" order="${level}"/>`,
  );
}

await writeFile(
  resolve(out, 'tilemapresource.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
    <TileMap version="1.0.0" tilemapservice="http://tms.osgeo.org/1.0.0">
      <Title>${name}</Title>
      <Abstract></Abstract>
      <SRS>EPSG:4326</SRS>
      <BoundingBox miny="-90.00000000000000" minx="-180.00000000000000" maxy="90.00000000000000" maxx="180.00000000000000"/>
      <Origin y="-90.00000000000000" x="-180.00000000000000"/>
      <TileFormat width="256" height="256" mime-type="image/jpg" extension="jpg"/>
      <TileSets profile="geodetic">
${sets.join('\n')}
      </TileSets>
    </TileMap>
`,
);

await rm(scratch, { recursive: true, force: true }).catch(() => {
  console.warn(`note: could not remove ${scratch}; safe to delete by hand`);
});
console.log(`\n${written} tiles, ${(bytes / 1e6).toFixed(0)} MB -> public/tiles/${name}`);
