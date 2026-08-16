import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const appUrl = process.env.CONTENTFLOW_E2E_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
  args: ['--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const saves = [];
const operations = [];

page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });

await page.route('**/api/quality', async (route) => {
  const payload = route.request().postDataJSON();
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      result: {
        ...payload.result,
        qualityReport: {
          status: 'ready', warnings: [], blockingErrors: [], factCheck: 'pass', sourceLeakCheck: 'pass',
          platformCheck: 'pass', aiStyleCheck: 'pass', riskCheck: 'pass', bodyLength: payload.result.bodyMarkdown.length,
        },
      },
    }),
  });
});

await page.route('**/api/contents**', async (route) => {
  const request = route.request();
  if (request.method() === 'GET') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contents: [] }) });
  }
  if (request.method() !== 'POST') return route.continue();
  const payload = request.postDataJSON();
  saves.push(payload);
  const now = new Date().toISOString();
  return route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      content: {
        id: payload.id || 'xhs-v4-content', name: payload.name, platform: payload.platform, materialIds: [],
        createdAt: now, updatedAt: now, status: 'saved',
        versions: [{ ...payload, id: `version-${saves.length}`, createdAt: now }],
      },
    }),
  });
});

await page.route('**/api/content-operations/stream', async (route) => {
  const payload = route.request().postDataJSON();
  operations.push(payload);
  const current = payload.currentResult;
  const result = {
    ...current,
    resultId: `xhs-v4-${payload.operation}-${operations.length}`,
    parentResultId: current.resultId,
    operation: payload.operation,
    operationId: `operation-${operations.length}`,
    qualityReport: { ...current.qualityReport, status: 'ready', warnings: [], blockingErrors: [] },
  };

  if (payload.operation === 'regenerate_titles') {
    result.titleCandidates = [
      '写代码时，先把重复理解交给 CodePilot',
      'CodePilot 如何读懂当前代码仓库',
      '更适合需要掌控感的 Agent 编程',
    ];
    result.selectedTitleIndex = 0;
  } else if (payload.operation === 'regenerate_body') {
    result.bodyMarkdown = '如果你正在改一个已有代码库，真正费时的往往是反复解释上下文。\n\n💡 CodePilot 会读取当前仓库信息，给出具体的修改建议。\n\n⚠️ 关键改动仍然需要你确认，它处理执行，你保留判断。\n\n适合想减少重复沟通，又不想交出代码决定权的开发者。';
    result.topics = ['Agent编程', '编程工具', '代码仓库', '开发者效率', 'CodePilot']
      .filter((topic) => !(current.removedTopics || []).includes(topic));
    result.commentPrompt = '你更希望 Agent 先帮你理解代码，还是直接给出修改建议？';
  } else if (payload.operation === 'custom_modify') {
    result.bodyMarkdown = `${current.bodyMarkdown}\n\n已按更明快的节奏重新整理。`;
    if (payload.formattingOverride?.platformFeel === 'active') {
      result.formatting = { platformFeel: 'active', label: '活跃表达' };
    }
  }

  const output = {
    operationId: result.operationId,
    result,
    changeSet: {
      changedFields: payload.operation === 'regenerate_titles'
        ? ['titleCandidates']
        : payload.operation === 'regenerate_body'
          ? ['bodyMarkdown', 'topics', 'commentPrompt']
          : ['bodyMarkdown', 'formatting'],
      fields: {},
    },
  };
  const sse = [
    `event: started\ndata: ${JSON.stringify({ operation: payload.operation, operationId: result.operationId })}\n\n`,
    `event: verifying\ndata: ${JSON.stringify({ checks: ['facts', 'platform'] })}\n\n`,
    `event: completed\ndata: ${JSON.stringify(output)}\n\n`,
  ].join('');
  await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: sse });
});

await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 15000 });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('contentflow-chat-cleared-20260815', '1');
  localStorage.setItem('contentflow-v1-draft', JSON.stringify({
    platform: 'xiaohongshu',
    tone: '自然分享：像正常分享，先说真实场景，再说作用和边界。',
    formattingOverride: { platformFeel: 'natural', emoji: 'auto' },
    dirty: false,
    messages: [{ id: 'xhs-v4-user', role: 'user', text: '请写一篇 CodePilot 的小红书产品介绍' }],
    result: {
      resultId: 'xhs-v4-seed', platform: 'xiaohongshu', platformMode: 'note', platformSpecVersion: '2026.08-v4',
      titleCandidates: [
        'CodePilot：代码改不改，由你确认',
        '让 Agent 读懂仓库，但不替你做决定',
        '一个保留确认权的编程 Agent',
      ],
      selectedTitleIndex: 0,
      bodyMarkdown: '改已有代码库时，最麻烦的常常不是写那几行代码，而是反复补充上下文。\n\nCodePilot 会读取当前代码仓库，并给出修改建议。\n\n关键代码只会在用户确认后应用，判断权仍然留在开发者手里。\n\n如果你需要的是理解仓库后再行动的 Agent，可以从一个真实任务开始试用。',
      topics: ['Agent编程', 'AI编程', '代码仓库', '开发者效率', 'CodePilot'],
      removedTopics: [],
      commentPrompt: '你最想把哪类重复编程任务交给 Agent？',
      formatting: { platformFeel: 'natural', label: '自然分享' },
      strategySnapshot: { contentType: 'product_marketing', authorRole: '产品团队' },
      qualityReport: {
        status: 'ready', warnings: [], blockingErrors: [], factCheck: 'pass', sourceLeakCheck: 'pass',
        platformCheck: 'pass', aiStyleCheck: 'pass', riskCheck: 'pass', bodyLength: 174,
      },
    },
  }));
});
await page.reload({ waitUntil: 'networkidle' });

const screenshotDir = path.resolve('screenshots', 'xhs-formatting-v4');
fs.mkdirSync(screenshotDir, { recursive: true });

const trigger = page.locator('.expression-mode-trigger');
await trigger.waitFor({ state: 'visible' });
await trigger.click();
const panel = page.locator('.expression-mode-panel:not(.is-mobile)');
await panel.waitFor({ state: 'visible' });
const feelLabels = await panel.locator('.platform-feel-option b').allTextContents();
const fourFeelOptionsVisible = ['自动', '克制', '自然', '活跃'].every((label) => feelLabels.includes(label));
await panel.getByText('活跃', { exact: true }).click();
await panel.getByRole('button', { name: '应用表达设置' }).click();
await page.getByText('活跃表达', { exact: true }).waitFor({ state: 'visible' });
const platformFeelApplied = operations.at(-1)?.formattingOverride?.platformFeel === 'active';

const originalTopics = await page.locator('.topic-chip .arco-tag-content').allTextContents();
const removedTopic = originalTopics[0].replace(/^#/, '');
await page.locator('.topic-chip .arco-tag-close-btn').first().click();
await page.waitForTimeout(1100);
const autosavePayload = saves.findLast((save) => save.reason === 'autosave');
const topicAutosaved = Boolean(autosavePayload && autosavePayload.removedTopics?.includes(removedTopic) && !autosavePayload.topics?.includes(removedTopic));

const bodyEditor = page.locator('.rich-editor:not(.is-candidate) .tiptap').first();
const bodyBeforeTitles = await bodyEditor.innerText();
const topicsBeforeTitles = await page.locator('.topic-chip .arco-tag-content').allTextContents();
await page.getByRole('button', { name: '换一批标题' }).click();
await page.locator('.result-title-panel.is-regenerating').waitFor({ state: 'visible', timeout: 5000 });
await page.locator('.result-title-panel.is-regenerating').waitFor({ state: 'detached', timeout: 10000 });
const titleRefreshPreservesBody = (await bodyEditor.innerText()) === bodyBeforeTitles;
const titleRefreshPreservesTopics = JSON.stringify(await page.locator('.topic-chip .arco-tag-content').allTextContents()) === JSON.stringify(topicsBeforeTitles);

const selectedTitleBeforeBody = await page.locator('.title-choice.active .title-choice-text').innerText();
await page.getByRole('button', { name: '换一批正文' }).click();
await page.locator('.result-document.is-regenerating').waitFor({ state: 'visible', timeout: 5000 });
await page.locator('.result-document.is-regenerating').waitFor({ state: 'detached', timeout: 10000 });
const bodyRefreshPreservesSelectedTitle = (await page.locator('.title-choice.active .title-choice-text').innerText()) === selectedTitleBeforeBody;
const bodyAfterRefresh = await bodyEditor.innerText();
const bodyChanged = bodyAfterRefresh !== bodyBeforeTitles;
const bodyShowsEmoji = /[\p{Extended_Pictographic}]/u.test(bodyAfterRefresh);
const bodyRendersShortParagraphs = await bodyEditor.locator('p').count() >= 4;
const topicsAfterBody = (await page.locator('.topic-chip .arco-tag-content').allTextContents()).map((topic) => topic.replace(/^#/, ''));
const removedTopicDidNotReturn = !topicsAfterBody.includes(removedTopic);
const bodyOperationPayload = operations.find((operation) => operation.operation === 'regenerate_body');
const bodyOperationCarriesCurrentTitle = bodyOperationPayload?.currentResult?.titleCandidates?.[bodyOperationPayload.currentResult.selectedTitleIndex || 0] === selectedTitleBeforeBody;

const desktopMetrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}));
await page.waitForTimeout(2400);
await page.screenshot({ path: path.join(screenshotDir, 'desktop-result.png'), fullPage: false });

await page.setViewportSize({ width: 390, height: 844 });
const mobileTrigger = page.locator('.expression-mode-trigger');
await mobileTrigger.waitFor({ state: 'visible' });
await mobileTrigger.scrollIntoViewIfNeeded();
await mobileTrigger.click();
const drawer = page.locator('.expression-mode-drawer .arco-drawer');
await drawer.waitFor({ state: 'visible' });
const mobileFeelCount = await drawer.locator('.platform-feel-option').count();
const mobilePanelBox = await drawer.locator('.expression-mode-panel.is-mobile').boundingBox();
const mobileMetrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
await page.screenshot({ path: path.join(screenshotDir, 'mobile-expression-drawer.png'), fullPage: false });
await drawer.getByRole('button', { name: '关闭表达方式' }).click();
await drawer.waitFor({ state: 'hidden', timeout: 5000 });
await page.locator('.result-message').scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(screenshotDir, 'mobile-result.png'), fullPage: false });

const publicProfileHidden = !(await page.locator('.result-message').innerText()).includes('formattingProfile');
const result = {
  fourFeelOptionsVisible,
  platformFeelApplied,
  topicAutosaved,
  titleRefreshPreservesBody,
  titleRefreshPreservesTopics,
  bodyRefreshPreservesSelectedTitle,
  bodyChanged,
  bodyShowsEmoji,
  bodyRendersShortParagraphs,
  removedTopicDidNotReturn,
  bodyOperationCarriesCurrentTitle,
  publicProfileHidden,
  desktopNoOverflow: desktopMetrics.scrollWidth === desktopMetrics.clientWidth,
  mobileFeelCount,
  mobilePanelWidth: mobilePanelBox?.width || 0,
  mobileNoOverflow: mobileMetrics.scrollWidth === mobileMetrics.clientWidth,
  errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();

const required = Object.entries(result).filter(([key]) => !['mobileFeelCount', 'mobilePanelWidth', 'errors'].includes(key));
if (required.some(([, value]) => value !== true) || mobileFeelCount !== 4 || (mobilePanelBox?.width || 0) < 350 || errors.length) process.exit(1);
