import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const apiBase = 'http://127.0.0.1:4176';
const marker = `删除交互验证-${Date.now()}`;
let contentId;
let browser;

try {
  const createdResponse = await fetch(`${apiBase}/api/contents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: marker,
      platform: 'xiaohongshu',
      titleCandidates: [marker],
      bodyMarkdown: '用于验证最近内容的删除交互。',
      topics: ['交互验证'],
      reason: 'e2e-recent-delete',
    }),
  });
  const created = await createdResponse.json();
  contentId = created.content.id;

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
    args: ['--disable-gpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 15000 });
  const item = page.locator('.recent-item', { hasText: marker });
  await item.waitFor({ state: 'visible' });
  const deleteButton = item.locator('.recent-delete');
  const defaultOpacity = await deleteButton.evaluate((element) => getComputedStyle(element).opacity);

  await item.hover();
  await page.waitForTimeout(180);
  const hoverState = await deleteButton.evaluate((element) => ({
    opacity: getComputedStyle(element).opacity,
    pointerEvents: getComputedStyle(element).pointerEvents,
    ariaLabel: element.getAttribute('aria-label'),
  }));

  fs.mkdirSync(path.resolve('screenshots'), { recursive: true });
  await page.screenshot({ path: path.resolve('screenshots', 'recent-delete-hover.png') });

  await deleteButton.click();
  const confirm = page.locator('.arco-modal', { hasText: '删除这条内容？' });
  await confirm.waitFor({ state: 'visible' });
  await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await item.waitFor({ state: 'detached' });

  const contents = await fetch(`${apiBase}/api/contents`).then((response) => response.json());
  const deletedFromApi = !contents.contents.some((content) => content.id === contentId);
  const result = {
    defaultHidden: defaultOpacity === '0',
    hoverVisible: hoverState.opacity === '1' && hoverState.pointerEvents === 'auto',
    accessibleName: hoverState.ariaLabel === `删除 ${marker}`,
    confirmationShown: true,
    removedFromList: await page.locator('.recent-item', { hasText: marker }).count() === 0,
    deletedFromApi,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));

  if (Object.values(result).slice(0, 6).some((value) => value !== true) || errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  if (contentId) await fetch(`${apiBase}/api/contents/${contentId}`, { method: 'DELETE' }).catch(() => {});
}
