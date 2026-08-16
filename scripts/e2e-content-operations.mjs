import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined), args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
const body = '在当今快速发展的时代，需要注意的是，内容工具不该替作者编造事实。\n\nNarraform 支持按平台生成文案，并在修改时保留当前版本。';
await page.evaluate(({ bodyMarkdown }) => {
  localStorage.clear();
  localStorage.setItem('contentflow-v1-draft', JSON.stringify({
    platform: 'generic',
    tone: '自然、专业',
    messages: [{ role: 'assistant', type: 'result', id: 'message-result' }],
    result: {
      resultId: 'rich-e2e-parent',
      platform: 'generic',
      titleCandidates: [],
      selectedTitleIndex: 0,
      summary: null,
      bodyMarkdown,
      topics: [],
      strategySnapshot: {},
      factIds: [],
      qualityReport: { status: 'ready', warnings: [], bodyLength: bodyMarkdown.length },
      specVersion: '2026.08-v1',
    },
    dirty: false,
  }));
}, { bodyMarkdown: body });
await page.reload({ waitUntil: 'networkidle' });
const editor = page.locator('.rich-editor:not(.is-candidate) .tiptap').first();
await editor.waitFor();
const toolbarButtons = await page.locator('.rich-editor-toolbar .arco-btn').count();
const markdownRendered = (await editor.locator('p').count()) === 2;
await editor.locator('p').first().dblclick();
await page.locator('.selection-polish').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
const selectionToolbarVisible = await page.locator('.selection-polish').isVisible().catch(() => false);
await page.getByText('正文', { exact: true }).click();

await page.getByRole('button', { name: /AI 润色/ }).click();
await page.getByText('去 AI 味', { exact: true }).click();
const candidate = page.locator('.stream-candidate');
await candidate.waitFor({ state: 'visible', timeout: 10000 });
const officialWhileStreaming = await editor.innerText();
const candidateVisible = await candidate.isVisible();
fs.mkdirSync(path.resolve('screenshots'), { recursive: true });
await page.screenshot({ path: path.resolve('screenshots', 'content-operation-streaming-desktop.png'), fullPage: false });
await page.locator('.operation-result-bar').waitFor({ timeout: 20000 });
const polished = await editor.innerText();
const appliedAfterCompleted = polished !== body && !/在当今快速发展的时代/.test(polished);
const officialPreservedDuringStream = officialWhileStreaming === body.replaceAll('\n\n', '\n\n');

await page.getByRole('button', { name: '撤销', exact: true }).click();
await page.getByText('已撤销上一次 AI 修改').waitFor({ timeout: 5000 });
const undoRestored = (await editor.innerText()) === body;

await page.getByRole('button', { name: /AI 润色/ }).click();
await page.getByText('去 AI 味', { exact: true }).click();
await candidate.waitFor({ state: 'visible', timeout: 10000 });
await candidate.getByRole('button', { name: '停止' }).evaluate((button) => button.click());
await candidate.waitFor({ state: 'hidden', timeout: 5000 });
const cancelPreservedContent = (await editor.innerText()) === body;
const cancelledNotApplied = !(await page.locator('.operation-result-bar').isVisible().catch(() => false));

await page.setViewportSize({ width: 390, height: 844 });
await page.locator('.body-field').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.resolve('screenshots', 'content-operation-rich-mobile.png'), fullPage: false });
const metrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  editorWidth: document.querySelector('.rich-editor')?.getBoundingClientRect().width || 0,
}));

console.log(JSON.stringify({
  toolbarButtons,
  markdownRendered,
  candidateVisible,
  officialPreservedDuringStream,
  appliedAfterCompleted,
  undoRestored,
  cancelPreservedContent,
  cancelledNotApplied,
  selectionToolbarVisible,
  metrics,
  errors,
}, null, 2));
await browser.close();
if (toolbarButtons < 9 || !markdownRendered || !candidateVisible || !officialPreservedDuringStream || !appliedAfterCompleted || !undoRestored || !cancelPreservedContent || !cancelledNotApplied || !selectionToolbarVisible || metrics.scrollWidth > metrics.clientWidth || metrics.editorWidth < 280 || errors.length) process.exit(1);
