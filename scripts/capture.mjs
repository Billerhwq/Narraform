import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
});

const output = path.resolve('screenshots');
fs.mkdirSync(output, { recursive: true });
const results = [];

for (const step of [0, 1, 2, 3]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:5173/?step=${step}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#root .app-shell');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(output, `desktop-step-${step + 1}.png`), fullPage: false, timeout: 15000 });
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyText: document.body.innerText.length,
    overflows: [...document.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 2).slice(0, 20).map((el) => ({ tag: el.tagName, className: String(el.className || ''), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
  }));
  results.push({ view: `desktop-step-${step + 1}`, ...metrics });
  await page.close();
}

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await mobile.goto('http://127.0.0.1:5173/?step=2', { waitUntil: 'domcontentloaded' });
await mobile.waitForSelector('#root .app-shell');
await mobile.waitForTimeout(700);
await mobile.screenshot({ path: path.join(output, 'mobile-review.png'), fullPage: false, timeout: 15000 });
results.push({ view: 'mobile-review', ...(await mobile.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  scrollHeight: document.documentElement.scrollHeight,
  bodyText: document.body.innerText.length,
  overflows: [...document.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 2).slice(0, 20).map((el) => ({ tag: el.tagName, className: String(el.className || ''), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
}))) });
await mobile.close();

fs.writeFileSync(path.join(output, 'metrics.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
