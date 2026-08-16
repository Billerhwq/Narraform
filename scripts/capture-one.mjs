import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const step = Number(process.argv[2] || 0);
const mobile = process.argv[3] === 'mobile';
const name = mobile ? `mobile-step-${step + 1}.png` : `desktop-step-${step + 1}.png`;
const output = path.resolve('screenshots', name);
fs.mkdirSync(path.dirname(output), { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
  args: ['--disable-gpu'],
});
const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 } });
page.setDefaultTimeout(15000);
page.on('console', (entry) => console.log(`console:${entry.type()}:${entry.text()}`));
page.on('pageerror', (error) => console.log(`pageerror:${error.message}`));
console.log('stage:goto');
await page.goto(`http://127.0.0.1:5173/?step=${step}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
console.log('stage:root');
await page.waitForSelector('#root .app-shell');
if (step > 0) {
  await page.getByRole('button', { name: '写一篇产品介绍' }).click();
  await page.waitForSelector('.result-message', { timeout: 5000 });
}
await page.waitForTimeout(600);
console.log('stage:metrics');
const metrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  scrollHeight: document.documentElement.scrollHeight,
  bodyText: document.body.innerText.length,
}));
console.log('stage:screenshot');
await page.screenshot({ path: output, fullPage: false, animations: 'disabled', timeout: 8000 });
console.log(JSON.stringify({ output, ...metrics }));
await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 1500))]);
process.exit(0);
