import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
  args: ['--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
let operationPayload;
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });

await page.route('**/api/quality', async (route) => {
  const payload = route.request().postDataJSON();
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ result: { ...payload.result, qualityReport: { status: 'ready', warnings: [], blockingErrors: [] } } }),
  });
});
await page.route('**/api/contents', async (route) => {
  const request = route.request();
  if (request.method() !== 'POST') return route.continue();
  const payload = request.postDataJSON();
  const now = new Date().toISOString();
  return route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({ content: { id: 'expression-e2e-content', name: payload.name, platform: payload.platform, materialIds: [], createdAt: now, updatedAt: now, status: 'saved', versions: [{ ...payload, id: 'expression-e2e-version', createdAt: now }] } }),
  });
});
await page.route('**/api/content-operations/stream', async (route) => {
  operationPayload = route.request().postDataJSON();
  const result = {
    ...operationPayload.currentResult,
    resultId: 'expression-mode-result-updated',
    parentResultId: operationPayload.currentResult.resultId,
    operation: 'custom_modify',
    operationId: 'expression-mode-operation',
    bodyMarkdown: '这是按专业解读方式改写后的文案。\n\n先给出判断，再解释依据、适用条件和能力边界。',
    qualityReport: { status: 'ready', warnings: [], blockingErrors: [] },
  };
  const output = {
    operationId: 'expression-mode-operation',
    result,
    changeSet: { changedFields: ['bodyMarkdown'], fields: { bodyMarkdown: { added: ['专业解读'], removed: [] } } },
  };
  const sse = [
    'event: started\ndata: {"operation":"custom_modify","operationId":"expression-mode-operation"}\n\n',
    'event: verifying\ndata: {"checks":["facts","platform"]}\n\n',
    `event: completed\ndata: ${JSON.stringify(output)}\n\n`,
  ].join('');
  await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: sse });
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 15000 });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('contentflow-chat-cleared-20260815', '1');
  localStorage.setItem('contentflow-v1-draft', JSON.stringify({
    platform: 'xiaohongshu',
    tone: '自然、专业',
    dirty: false,
    messages: [{ id: 'expression-user', role: 'user', text: '写一篇 Tlink 产品介绍' }],
    result: {
      resultId: 'expression-mode-result',
      platform: 'xiaohongshu',
      platformMode: 'note',
      titleCandidates: ['Tlink 把重复投递交给 AI', 'AI 求职助手如何减少重复操作', '把时间留给岗位判断'],
      selectedTitleIndex: 0,
      summary: null,
      bodyMarkdown: '产品名是 Tlink，它把重复的简历投递交给 AI 工具处理。\n\n用户仍然负责岗位选择和判断，工具处理已确认后的执行环节。',
      topics: ['Tlink', 'AI求职', '简历投递'],
      strategySnapshot: { contentType: 'product_marketing' },
      qualityReport: { status: 'ready', warnings: [], blockingErrors: [] },
    },
  }));
});
await page.reload({ waitUntil: 'networkidle' });

const trigger = page.locator('.expression-mode-trigger');
await trigger.waitFor({ state: 'visible' });
const legacyMigrated = (await trigger.innerText()).includes('AI 推荐 · 主理人讲产品');
await trigger.click();
const panel = page.locator('.expression-mode-panel:not(.is-mobile)');
await panel.waitFor({ state: 'visible' });
await page.waitForTimeout(220);
const optionTexts = await panel.locator('.expression-mode-option').allTextContents();
const richOptions = optionTexts.length === 5
  && optionTexts.some((text) => text.includes('为什么做 → 核心能力 → 适用边界'))
  && optionTexts.some((text) => text.includes('先给判断 → 解释依据 → 补充限制'));
fs.mkdirSync(path.resolve('screenshots'), { recursive: true });
await page.screenshot({ path: path.resolve('screenshots', 'expression-mode-desktop.png') });

const expertOption = panel.locator('.expression-mode-option').filter({ hasText: '专业解读' });
if (await expertOption.count() !== 1) throw new Error(`表达方式列表缺少“专业解读”：${optionTexts.join(' | ')}`);
await expertOption.click();
const explicitApply = await panel.getByRole('button', { name: '按“专业解读”改写' }).isEnabled();
await panel.getByRole('button', { name: '按“专业解读”改写' }).click();
await page.waitForFunction(() => document.querySelector('.expression-mode-trigger')?.textContent.includes('专业解读'));
const operationConnected = operationPayload?.operation === 'custom_modify'
  && operationPayload?.tone?.startsWith('专业解读：')
  && operationPayload?.instruction?.includes('按“专业解读”重写');
const rewriteApplied = (await page.locator('.rich-editor-canvas').innerText()).includes('这是按专业解读方式改写后的文案');

await page.setViewportSize({ width: 390, height: 844 });
await trigger.click();
const drawer = page.locator('.expression-mode-drawer .arco-drawer');
await drawer.waitFor({ state: 'visible' });
await page.waitForTimeout(320);
const mobileUsesDrawer = await drawer.locator('.expression-mode-panel.is-mobile').isVisible();
const mobileMetrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
await page.screenshot({ path: path.resolve('screenshots', 'expression-mode-mobile.png') });
await drawer.getByRole('button', { name: '关闭表达方式' }).click();

const result = {
  legacyMigrated,
  richOptions,
  explicitApply,
  operationConnected,
  rewriteApplied,
  mobileUsesDrawer,
  mobileNoOverflow: mobileMetrics.scrollWidth === mobileMetrics.clientWidth,
  errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();

if (Object.values(result).slice(0, 7).some((value) => value !== true) || errors.length) process.exit(1);
