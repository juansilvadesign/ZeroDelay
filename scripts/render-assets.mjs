// Renders every creative HTML under publishing/assets (recursively) to a PNG of the
// same name, at the pixel size declared on <body> (width/height in the CSS). Fonts
// (Departure Mono, self-hosted) and local images resolve via file:// relative paths.
//
// Usage:
//   node scripts/render-assets.mjs                 # render all
//   node scripts/render-assets.mjs carrossel post- # render only paths matching a filter
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const root = fileURLToPath(new URL('../publishing/assets', import.meta.url));

const htmls = [];
(function walk(dir) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.html')) htmls.push(p);
    }
})(root);

const filters = process.argv.slice(2);
const targets = (filters.length ? htmls.filter(h => filters.some(f => h.includes(f))) : htmls).sort();

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--force-color-profile=srgb'] });
let done = 0;
for (const html of targets) {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(html).href, { waitUntil: 'networkidle0' });
    // The creatives fix their canvas size on <body> (e.g. 1080x1350). Read it, size
    // the viewport to match, wait for webfonts, then clip the screenshot to it.
    const { w, h } = await page.evaluate(() => {
        const s = getComputedStyle(document.body);
        return { w: Math.round(parseFloat(s.width)), h: Math.round(parseFloat(s.height)) };
    });
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    const out = html.replace(/\.html$/, '.png');
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } });
    await page.close();
    done++;
    console.log(`  ${w}x${h}  ${out.slice(root.length + 1).replace(/\\/g, '/')}`);
}
await browser.close();
console.log(`\n${done} PNG(s) gerado(s).`);
