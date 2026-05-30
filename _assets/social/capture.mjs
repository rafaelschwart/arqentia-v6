// capture.mjs — record Coming Soon Post as 1080x1920 webm via Playwright.
// Simple flow: navigate → wait for fonts → record real-time playback for
// DURATION_MS. ffmpeg trims front pre-roll in the encode step.
//
// Run:  node _assets/social/capture.mjs

import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE         = path.resolve('_assets/social');
const HTML_PATH    = path.join(HERE, 'coming-soon-render.html');
const OUT_DIR      = path.join(HERE, '_video');
const DURATION_MS  = 18_000;

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--force-color-profile=srgb',
    '--font-render-hinting=none'
  ]
});

const ctx = await browser.newContext({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: OUT_DIR,
    size: { width: 1080, height: 1920 }
  },
  colorScheme: 'dark'
});

const page = await ctx.newPage();

await page.goto(pathToFileURL(HTML_PATH).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ARQ_READY === true, null, { timeout: 8000 }).catch(() => {});

// Animations begin at page paint. We start counting recorded time from here.
console.log(`Recording ${DURATION_MS / 1000}s @ Playwright native fps · 1080x1920…`);
const t0 = Date.now();
await page.waitForTimeout(DURATION_MS);
console.log(`Captured ${((Date.now() - t0) / 1000).toFixed(1)}s of real time.`);

await page.close();
await ctx.close();
await browser.close();

const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.webm'));
if (!files.length) { console.error('No video produced.'); process.exit(1); }
const src = path.join(OUT_DIR, files[0]);
const dst = path.join(OUT_DIR, 'capture.webm');
fs.renameSync(src, dst);
console.log(`Output: ${dst} (${(fs.statSync(dst).size / 1024 / 1024).toFixed(2)} MB)`);
