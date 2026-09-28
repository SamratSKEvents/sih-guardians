// Precomputes the Spills map's ships (src/layers/slickVessels.ts → computeSlickVessels)
// into public/data/slick-vessels.json. Rerun after changing the 20 slicks or their bundles.
// Run: node tools/slick-vessels.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const pub = new URL('../public', import.meta.url);
// The module fetches /data/...; serve those from public/ on disk.
globalThis.fetch = async (url) => {
  try {
    const body = await readFile(new URL(`.${url}`, pub.href + '/'));
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => undefined };
  }
};

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { computeSlickVessels } = await vite.ssrLoadModule('/src/layers/slickVessels.ts');
  const t = Date.now();
  const list = await computeSlickVessels();
  await writeFile(new URL('data/slick-vessels.json', pub.href + '/'), JSON.stringify(list));
  console.log(list.length, 'vessels in', ((Date.now() - t) / 1000).toFixed(1), 's');
} finally {
  await vite.close();
}
