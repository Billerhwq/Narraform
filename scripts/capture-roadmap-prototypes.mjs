import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.ROADMAP_PROTOTYPE_URL || 'http://127.0.0.1:5188/';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
const outputDirectory = path.resolve('docs/prototypes');
const names = [
  'phase-1-content-engine.png',
  'phase-2-material-understanding.png',
  'phase-3-draft-publishing.png',
  'phase-4-feedback-loop.png',
];

fs.mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-gpu'] });
const results = [];

try {
  for (let phase = 1; phase <= 4; phase += 1) {
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
    await page.goto(`${baseUrl}?phase=${phase}`, { waitUntil: 'networkidle', timeout: 20_000 });
    await page.screenshot({ path: path.join(outputDirectory, names[phase - 1]), fullPage: false });
    const audit = await page.evaluate(() => ({
      title: document.title,
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      visibleText: document.body.innerText.length,
      shell: Boolean(document.querySelector('.screen-shell')),
    }));
    results.push({ phase, errors, ...audit, overflow: audit.width > audit.viewport });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.errors.length || result.overflow || !result.shell || result.visibleText < 300)) process.exitCode = 1;

