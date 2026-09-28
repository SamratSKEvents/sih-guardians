// Drops catalogue slicks whose centroid is on land from public/data/catalog/meta.json
// (the map only draws ids in meta), and lists any of the 20 demo slicks on land.
// Run after tools/catalog-meta.mjs: node tools/land-check.mjs
import { writeFileSync } from 'node:fs';
import { onLand, read } from './land.mjs';

const demo = read('src/data/slicks.json').filter((s) => onLand(...s.properties.centroid)).map((s) => s.id);
const meta = read('public/data/catalog/meta.json');
const landed = Object.keys(meta).filter((id) => onLand(meta[id][2], meta[id][3]));
for (const id of landed) delete meta[id];
writeFileSync(new URL('../public/data/catalog/meta.json', import.meta.url), JSON.stringify(meta));
console.log('demo on land:', demo.length ? demo : 'none');
console.log('catalogue dropped:', landed.length, '→', Object.keys(meta).length, 'kept');
