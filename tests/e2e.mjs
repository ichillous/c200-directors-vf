// End-to-end check in Chromium with a fake camera. Start `npm run preview` first, then `npm run e2e`.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');

const base = process.env.APP_URL ?? 'http://localhost:4173/';
const shots = new URL('./shots/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 916, height: 412 }, permissions: ['camera'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const snap = (name) => page.screenshot({ path: `${shots}${name}.png` });
const rail = (name) => page.locator('.rail__item', { hasText: name }).click();

await page.goto(base);
await page.waitForSelector('.view video:not([hidden])', { timeout: 15000 });
assert.equal(await page.locator('.readout__num').innerText(), '24');
await snap('01-finder');

// The ring drives the readout and the frame lines.
await page.locator('.ring input').fill('35');
assert.equal(await page.locator('.readout__num').innerText(), '35');
assert.match(await page.locator('.readout__more').innerText(), /51 mm full-frame/);
const narrow = await page.locator('.view__frame').boundingBox();
await page.locator('.ring input').fill('18');
const wide = await page.locator('.view__frame').boundingBox();
assert.ok(Math.abs(narrow.width / wide.width - 18 / 35) < 0.01, 'frame width follows focal length');
await page.getByRole('button', { name: /DCI 17:9/ }).click();
await page.waitForSelector('.view__wide');
await snap('02-finder-dci-18');
await page.getByRole('button', { name: /UHD 16:9/ }).click();

// Capture a tagged frame into the bank.
await page.locator('.ring input').fill('28');
await page.getByRole('button', { name: 'B-roll', exact: true }).click();
await page.getByRole('button', { name: 'Capture this frame' }).click();
await page.waitForSelector('.view__toast');
assert.match(await page.locator('.view__toast').innerText(), /Saved to Shot Bank, B-roll/);

// Empty shoots, then import the sample data file.
await rail('Shoots');
await snap('03-shoots-empty');
await page.locator('input[type=file]').setInputFiles(new URL('./fixtures/sample-data.json', import.meta.url).pathname);
await page.waitForSelector('.notice');
assert.match(await page.locator('.notice').innerText(), /Imported 4 shoots and 1 shot list/);
await page.getByLabel('What the shoot is').fill('Park interview');
await page.getByRole('button', { name: 'Create' }).click();
await page.waitForSelector('.live:has-text("Park-interview")');
await snap('04-shoots');

// Shot board to viewfinder.
await page.locator('.live', { hasText: 'Example short film' }).click();
await page.locator('.shot', { hasText: '04' }).click();
await snap('05-board');
await page.getByRole('button', { name: 'Frame this shot' }).click();
assert.equal(await page.locator('.readout__num').innerText(), '28');
await page.waitForSelector('.ring__band');
await page.getByRole('button', { name: 'Capture this frame' }).click();
// Moving on straight away must not change the frame that is still being saved.
await page.getByRole('button', { name: 'Next shot' }).click();
assert.equal(await page.locator('.readout__num').innerText(), '18');
await page.waitForSelector('.view__toast:has-text("shot 04")');
await snap('06-finder-shot');

// Save-to sheet and camera sheet.
await page.locator('.finder__right .picker').click();
await snap('07-save-to');
await page.getByRole('option', { name: 'Shot Bank' }).click();
await page.locator('.view__phone').click();
await snap('08-phone-camera');
await page.getByRole('button', { name: 'Close' }).click();

// Bank: two frames, with pictures from the camera.
await rail('Bank');
await page.waitForSelector('.card img');
assert.equal(await page.locator('.card').count(), 2);
assert.match(await page.locator('.card').first().innerText(), /28 mm\s+Shot 04, Hands/);
await page.locator('.card').first().click();
await snap('09-bank');
await page.locator('.detail .picker').last().click();
await snap('10-bank-file-under');
await page.getByRole('button', { name: 'Close' }).click();
const download = page.waitForEvent('download');
await page.getByRole('button', { name: 'Export frames' }).click();
assert.match((await download).suggestedFilename(), /^c200-frames-\d{4}-\d{2}-\d{2}\.zip$/);
await page.getByRole('button', { name: 'Delete' }).click();
assert.equal(await page.locator('.card').count(), 1);
await page.getByRole('button', { name: 'Undo' }).click();
assert.equal(await page.locator('.card').count(), 2);

// Kit.
await rail('Kit');
await page.locator('.check').first().click();
await page.getByRole('button', { name: 'Swap inputs 1 and 2' }).click();
assert.match(await page.locator('.kit__col').last().innerText(), /Input 1: Rode Wireless PRO/);
await snap('11-kit');

// Everything survives a reload.
await page.reload();
await page.waitForSelector('.rail__item');
assert.match(await page.locator('.rail').innerText(), /Bank 2/);
assert.match(await page.locator('.rail').innerText(), /Kit 1\/7/);

// Portrait shows the turn-the-phone message.
await page.setViewportSize({ width: 412, height: 916 });
await page.waitForSelector('.rotate');
await snap('12-portrait');

await browser.close();
assert.deepEqual(errors, [], 'no console errors');
console.log('e2e passed, screenshots in tests/shots');
