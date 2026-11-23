// Renders public/icon.svg to the web icons and the Android launcher icons.
// Run with: node scripts/make-icons.mjs   (needs Playwright with Chromium)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const out = (p) => new URL(`../${p}`, import.meta.url).pathname;
const browser = await chromium.launch();

async function render(path, size, { scale = 1, radius = '0', transparent = false } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * scale);
  await page.setContent(`<style>html,body{margin:0;background:transparent}
    .box{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:${radius};background:${transparent ? 'transparent' : '#121315'}}
    svg{display:block;width:${inner}px;height:${inner}px}</style><div class="box">${svg}</div>`);
  await page.screenshot({ path: out(path), omitBackground: true });
  await page.close();
}

for (const size of [192, 512]) await render(`public/icon-${size}.png`, size);

// Android: legacy square and round icons, plus the adaptive foreground (art kept inside the safe zone).
const res = 'android/app/src/main/res';
for (const [density, px] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  await render(`${res}/mipmap-${density}/ic_launcher.png`, px, { radius: '18%' });
  await render(`${res}/mipmap-${density}/ic_launcher_round.png`, px, { radius: '50%' });
  await render(`${res}/mipmap-${density}/ic_launcher_foreground.png`, Math.round(px * 2.25), { scale: 0.62, transparent: true });
}
await browser.close();
