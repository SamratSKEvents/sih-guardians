/**
 * Merge each slick's per-tile Sentinel-2 crops (tools/eo/raw, transparent where a
 * tile has no data) into one JPEG in public/data/eo, using a headless browser's
 * canvas: no native image library needed. Then drops the raw paths from the index.
 *
 *   node tools/eo/composite.cjs [path/to/puppeteer]
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require(process.argv[2] || 'puppeteer');

const OUT = path.resolve(__dirname, '../../public/data/eo');
const indexPath = path.join(OUT, 'index.json');

(async () => {
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  for (const [id, e] of Object.entries(index)) {
    if (e.status !== 'AVAILABLE' || !e.parts) continue;
    const urls = e.parts.filter((p) => fs.existsSync(p)).map((p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64'));
    const jpg = await page.evaluate(async (urls) => {
      const imgs = await Promise.all(urls.map((u) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; })));
      const c = document.createElement('canvas');
      c.width = imgs[0].naturalWidth; c.height = imgs[0].naturalHeight;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      for (const i of imgs) g.drawImage(i, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    }, urls);
    const file = path.join(OUT, path.basename(e.file));
    fs.writeFileSync(file, Buffer.from(jpg.split(',')[1], 'base64'));
    delete e.parts;
    console.log(id, urls.length, 'tiles ->', Math.round(fs.statSync(file).size / 1024), 'KB');
  }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
  await browser.close();
})();
