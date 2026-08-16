import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined), args: ['--disable-gpu'] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on('pageerror', error => errors.push(error.message));
page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 15000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
const welcomeVisible = await page.getByRole('heading', { name: '今天想写什么？' }).isVisible();
fs.mkdirSync(path.resolve('screenshots'), { recursive: true });
await page.screenshot({ path: path.resolve('screenshots', 'v1-empty-desktop.png'), fullPage: false });

const composer = page.getByPlaceholder(/描述你想写的内容/);
await composer.fill('帮我宣传一下');
await page.getByRole('button', { name: '生成文案' }).click();
await page.getByText('要宣传或介绍什么？', { exact: false }).waitFor({ timeout: 15000 });
const needsInput = await page.getByText('要宣传或介绍什么？', { exact: false }).isVisible();

await page.getByRole('button', { name: '添加资料' }).click();
await page.getByRole('button', { name: '粘贴文字' }).click();
await page.getByPlaceholder(/粘贴需要用于写作的正文/).fill('Narraform 是一个 AI 文案助手。它支持小红书、知乎、微信公众号和通用文案。系统会先抽取事实，再按平台规则生成内容。内部文件名和 README 只用于理解资料，不应出现在对外文案中。');
await page.getByRole('button', { name: '使用这段文字' }).click();
await page.getByText('资料已读取').waitFor({ timeout: 10000 });
await page.locator('.arco-drawer .arco-icon-close').first().click();

await composer.fill('产品名是 Narraform。面向内容运营，写一篇自然的小红书产品介绍，不要营销腔，不要虚构体验。');
await page.getByRole('button', { name: '生成文案' }).click();
await page.getByRole('heading', { name: '选择这篇文案怎么切入' }).waitFor({ timeout: 15000 });
const strategyCount = await page.locator('.strategy-option').count();
const strategyVisible = strategyCount === 3;
await page.screenshot({ path: path.resolve('screenshots', 'v2-strategy-desktop.png'), fullPage: false });
await page.getByRole('button', { name: '用这个方向' }).first().click();
await page.locator('.result-message').waitFor({ timeout: 150000 });
const resultHeader = await page.locator('.result-head').innerText();
const titleOptionCount = await page.getByRole('radio', { name: /选择标题/ }).count();
const internalMetadataHidden = !(await page.locator('.result-message').innerText()).includes('product_marketing');
const quickActionsVisible = await page.getByRole('button', { name: '降低营销感' }).isVisible()
  && await page.getByRole('button', { name: '换个开头' }).isVisible()
  && await page.getByRole('button', { name: '补充适用边界' }).isVisible();
const regenerateButtonsVisible = await page.getByRole('button', { name: '换一批标题' }).isVisible()
  && await page.getByRole('button', { name: '换一批正文' }).isVisible();
const bodyEditor = page.locator('.rich-editor:not(.is-candidate) .tiptap').first();
let body = await bodyEditor.innerText();
const sourceIsolated = !/README|根据.*(?:资料|文档|文件)|基于.*(?:资料|文档|文件)|你提供的资料/i.test(body);
await page.getByRole('button', { name: '换一批标题' }).click();
await page.locator('.result-title-panel.is-regenerating').waitFor({ state: 'visible', timeout: 5000 });
await page.locator('.result-title-panel.is-regenerating').waitFor({ state: 'detached', timeout: 150000 });
const titleRefreshPreservesBody = await bodyEditor.innerText() === body;
const titlesBeforeBodyRefresh = await page.locator('.title-choice-text').allTextContents();
await page.getByRole('button', { name: '换一批正文' }).click();
await page.locator('.result-document.is-regenerating').waitFor({ state: 'visible', timeout: 5000 });
await page.locator('.result-document.is-regenerating').waitFor({ state: 'detached', timeout: 150000 });
const titlesAfterBodyRefresh = await page.locator('.title-choice-text').allTextContents();
const bodyRefreshPreservesTitles = JSON.stringify(titlesAfterBodyRefresh) === JSON.stringify(titlesBeforeBodyRefresh);
body = await bodyEditor.innerText();
await bodyEditor.fill(`${body}\n\n这是手工补充的一句。`);
await page.getByRole('button', { name: '降低营销感' }).click();
await page.locator('.operation-result-bar').waitFor({ timeout: 150000 });
await page.locator('.title-choice').nth(1).locator('.title-choice-text').click();
const selectedTitleVisible = await page.locator('.title-choice.active').count() === 1;
await page.getByRole('button', { name: '保存版本' }).click();
await page.getByText('已保存到内容记录').waitFor({ timeout: 15000 });
await page.locator('.result-actions').getByRole('button', { name: '更多' }).click();
await page.getByText('查看版本记录', { exact: true }).click();
const versionsVisible = await page.getByText('版本记录').last().isVisible();
const versionCount = await page.locator('.version-list > div').count();
await page.locator('.arco-drawer .arco-icon-close').last().click();
await page.locator('.result-head button').click();
const qualityTitle = page.getByText('文案检查', { exact: true }).last();
await qualityTitle.waitFor({ state: 'visible', timeout: 15000 });
const qualityVisible = await qualityTitle.isVisible();
const qualityDrawer = qualityTitle.locator('xpath=ancestor::div[contains(@class,"arco-drawer")]');
await qualityDrawer.locator('.arco-icon-close').click();
await qualityDrawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
await page.screenshot({ path: path.resolve('screenshots', 'v2-result-desktop.png'), fullPage: false });
await page.getByRole('button', { name: '内容记录' }).click();
const historyLeaveDialog = page.getByText('离开当前文案？');
if (await historyLeaveDialog.isVisible().catch(() => false)) await page.getByRole('button', { name: '查看内容记录' }).click();
await page.locator('.library-row').first().waitFor({ timeout: 15000 });
const historyVisible = await page.getByText(/个版本/).first().isVisible();
await page.getByRole('button', { name: '打开' }).first().click();
const leaveDialog = page.getByText('打开其他文案？');
const leaveDialogVisible = await leaveDialog.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false);
if (leaveDialogVisible) await page.getByRole('button', { name: '确定' }).click();
await leaveDialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
await page.locator('.rich-editor:not(.is-candidate) .tiptap').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
const reopened = await page.locator('.rich-editor:not(.is-candidate) .tiptap').first().isVisible().catch(() => false) && !await leaveDialog.isVisible().catch(() => false);
const desktopMetrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

await page.screenshot({ path: path.resolve('screenshots', 'v1-desktop.png'), fullPage: false });
await page.setViewportSize({ width: 390, height: 844 });
await page.locator('.result-message').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.resolve('screenshots', 'v2-result-mobile.png'), fullPage: false });
await page.setViewportSize({ width: 1440, height: 960 });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
mobile.on('pageerror', error => errors.push(error.message));
mobile.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
await mobile.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 15000 });
const mobileComposer = await mobile.getByPlaceholder(/描述你想写的内容/).isVisible();
await mobile.getByRole('button', { name: '打开导航' }).click();
const mobileMenu = await mobile.getByRole('complementary', { name: '主菜单' }).isVisible();
await mobile.waitForTimeout(400);
const mobileMenuBox = await mobile.getByRole('complementary', { name: '主菜单' }).boundingBox();
const mobileNewCopy = await mobile.getByRole('button', { name: '新建文案' }).isVisible();
await mobile.screenshot({ path: path.resolve('screenshots', 'v1-mobile-menu.png'), fullPage: false });
const mobileMetrics = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

const contents = await (await fetch('http://127.0.0.1:4176/api/contents')).json();
for (const item of contents.contents) await fetch(`http://127.0.0.1:4176/api/contents/${item.id}`, { method: 'DELETE' });

const result = { welcomeVisible, needsInput, strategyVisible, strategyCount, resultHeader, titleOptionCount, selectedTitleVisible, internalMetadataHidden, quickActionsVisible, regenerateButtonsVisible, titleRefreshPreservesBody, bodyRefreshPreservesTitles, sourceIsolated, versionsVisible, versionCount, qualityVisible, historyVisible, reopened, mobileComposer, mobileMenu, mobileMenuWidth: mobileMenuBox?.width || 0, mobileNewCopy, desktopMetrics, mobileMetrics, errors };
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (!welcomeVisible || !needsInput || !strategyVisible || !/小红书文案/.test(resultHeader) || titleOptionCount < 3 || !selectedTitleVisible || !internalMetadataHidden || !quickActionsVisible || !regenerateButtonsVisible || !titleRefreshPreservesBody || !bodyRefreshPreservesTitles || !sourceIsolated || !versionsVisible || versionCount < 2 || !qualityVisible || !historyVisible || !reopened || !mobileComposer || !mobileMenu || !mobileNewCopy || (mobileMenuBox?.width || 0) < 240 || desktopMetrics.scrollWidth > desktopMetrics.clientWidth || mobileMetrics.scrollWidth > mobileMetrics.clientWidth || errors.length) process.exit(1);
