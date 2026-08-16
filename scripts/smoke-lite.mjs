import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
  args: ['--disable-gpu'],
});

const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.on('pageerror', error => errors.push(error.message));
page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 10000 });
await page.waitForSelector('#root .app-shell', { timeout: 5000 });

const emptyVisible = await page.getByText('今天想写什么？').isVisible();
await page.getByPlaceholder(/告诉我你想写什么/).fill('根据产品资料写一篇自然的小红书介绍，不要使用 README 口吻。');
await page.getByRole('button', { name: '生成文案' }).click();
await page.waitForSelector('.result-message', { timeout: 5000 });
const resultVisible = await page.getByLabel('生成的文案').isVisible();
const noPreview = await page.locator('.artifact-stage, .platform-tabs, .xhs-sheet').count() === 0;
await page.getByRole('button', { name: '保存' }).click();
const saveToastVisible = await page.getByText('已保存到内容记录').isVisible();
await page.getByRole('button', { name: '内容记录' }).click();
const historyVisible = await page.getByText('查看以前生成的文案，继续修改或重新使用。').isVisible();
const desktopMetrics = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
mobile.on('pageerror', error => errors.push(error.message));
mobile.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
await mobile.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded', timeout: 10000 });
const mobileComposerVisible = await mobile.getByPlaceholder(/告诉我你想写什么/).isVisible();
await mobile.getByRole('button', { name: '打开导航' }).click();
const mobileMenuVisible = await mobile.getByRole('complementary', { name: '主菜单' }).isVisible();
const mobileMetrics = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));

const result = { emptyVisible, resultVisible, noPreview, saveToastVisible, historyVisible, mobileComposerVisible, mobileMenuVisible, desktopMetrics, mobileMetrics, errors };
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (!emptyVisible || !resultVisible || !noPreview || !saveToastVisible || !historyVisible || !mobileComposerVisible || !mobileMenuVisible || desktopMetrics.scrollWidth > desktopMetrics.clientWidth || mobileMetrics.scrollWidth > mobileMetrics.clientWidth || errors.length) process.exit(1);
