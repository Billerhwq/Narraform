import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const webUrl = process.env.NARRAFORM_WEB_URL || 'http://127.0.0.1:5173';
const apiUrl = process.env.NARRAFORM_API_URL || 'http://127.0.0.1:4176';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined);
const token = Date.now().toString().slice(-7);
const productName = `CodeLoop-${token}`;
const screenshots = path.resolve('screenshots', 'roadmap-v1');
fs.mkdirSync(screenshots, { recursive: true });

async function api(pathname, options = {}) {
  const response = await fetch(`${apiUrl}${pathname}`, options);
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${response.status} ${pathname}: ${JSON.stringify(payload)}`);
  return payload;
}

async function waitForTransientUi(page) {
  await page.waitForFunction(
    () => document.querySelectorAll('.arco-message-wrapper').length === 0,
    undefined,
    { timeout: 8_000 },
  ).catch(() => {});
}

const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(error.message));
page.on('console', (entry) => { if (entry.type() === 'error') browserErrors.push(entry.text()); });

try {
  await page.goto(webUrl, { waitUntil: 'networkidle', timeout: 20_000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  await page.getByRole('button', { name: '添加资料' }).click();
  await page.getByRole('button', { name: '打开资料整理' }).click();
  await page.getByRole('heading', { name: '整理创作资料' }).waitFor();
  await page.locator('.materials-workspace').getByRole('button', { name: '粘贴文字' }).click();
  const materialModal = page.locator('.arco-modal').filter({ hasText: '粘贴产品说明或创作要求' });
  await materialModal.locator('textarea').fill(`${productName} 是一个协助完成编码任务的 Agent。${productName} 可以读取用户授权的代码仓库。${productName} 会把编码目标拆解为执行计划。${productName} 可以修改代码并运行项目测试。`);
  await materialModal.getByRole('button', { name: '确定' }).click();
  await page.locator('.material-source-list').getByText('补充说明', { exact: true }).waitFor();
  const imagePath = path.resolve('docs', 'prototypes', 'phase-1-content-engine.png');
  await page.locator('.materials-workspace input[type=file]').setInputFiles(imagePath);
  await page.locator('.material-source-list').getByText('phase-1-content-engine.png', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '用这些资料创作' }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('用这些资料创作'));
    return button && !button.disabled;
  }, undefined, { timeout: 30_000 });
  await waitForTransientUi(page);
  await page.screenshot({ path: path.join(screenshots, '01-materials-desktop.png'), fullPage: false });

  await page.getByRole('button', { name: '用这些资料创作' }).click();
  const composer = page.getByPlaceholder(/描述你想写的内容/);
  await composer.fill(`产品名是 ${productName}，面向独立开发者写一篇自然的小红书产品介绍，不虚构效果。`);
  await page.getByRole('button', { name: '生成文案' }).click();
  await page.getByRole('heading', { name: '选择这篇文案怎么切入' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '用这个方向' }).first().click();
  await page.locator('.result-message').waitFor({ timeout: 60_000 });
  await page.getByText(/已自动保存/).first().waitFor({ timeout: 15_000 });
  await waitForTransientUi(page);
  await page.screenshot({ path: path.join(screenshots, '02-content-desktop.png'), fullPage: false });

  const contentData = await api('/api/contents');
  const currentContent = contentData.contents[0];
  if (!currentContent) throw new Error('内容没有自动保存');

  await page.getByRole('button', { name: '发布', exact: true }).click();
  await page.getByRole('heading', { name: '保存到平台草稿' }).waitFor();
  await page.getByRole('button', { name: '生成平台发布包' }).first().click();
  await page.getByRole('heading', { name: '小红书发布包' }).waitFor({ timeout: 60_000 });
  await page.getByText('可以保存草稿', { exact: true }).waitFor();
  await waitForTransientUi(page);
  await page.screenshot({ path: path.join(screenshots, '03-publish-preflight-desktop.png'), fullPage: false });
  await page.getByRole('button', { name: /保存到 1 个平台草稿/ }).click();
  await page.getByText('草稿已验证送达', { exact: true }).waitFor({ timeout: 30_000 });
  const jobs = await api('/api/delivery-jobs');
  if (jobs.jobs[0]?.status !== 'delivered') throw new Error(`发布任务未验证送达: ${jobs.jobs[0]?.status}`);
  const receiptId = jobs.jobs[0].items[0].receiptId;

  for (let index = 0; index < 5; index += 1) {
    const baseline = await api('/api/contents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `E2E 同类基线 ${token}-${index}`, platform: 'xiaohongshu', titleCandidates: [`同类标题 ${index}`], bodyMarkdown: '同平台同目标的基线内容', strategySnapshot: { goal: 'save', contentType: 'product_marketing' } }) });
    await api('/api/performance-snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId: baseline.content.id, contentRevision: 1, platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, source: 'manual', metrics: { reads: 10000, saves: 300 + index * 10 } }) });
  }

  await page.getByRole('button', { name: '复盘', exact: true }).click();
  await page.getByRole('heading', { name: '内容复盘' }).waitFor();
  const contentSelect = page.locator('.review-workspace .roadmap-page-actions .arco-select');
  await contentSelect.click();
  await page.locator('.arco-select-popup').getByText(currentContent.name, { exact: true }).click();
  await page.getByRole('button', { name: '补充表现数据' }).first().click();
  const metricModal = page.locator('.arco-modal').filter({ hasText: '补充这篇内容的表现' });
  const fillMetric = async (label, value) => metricModal.locator('label').filter({ hasText: label }).locator('input').fill(String(value));
  await fillMetric('曝光', 18420);
  await fillMetric('阅读', 15107);
  await fillMetric('点赞', 612);
  await fillMetric('收藏', 941);
  await fillMetric('评论', 83);
  await fillMetric('分享', 126);
  await metricModal.getByRole('button', { name: '保存并复盘' }).click();
  await page.getByText(/收藏率高于同目标内容中位数/).waitFor({ timeout: 30_000 });
  await waitForTransientUi(page);
  await page.screenshot({ path: path.join(screenshots, '04-review-desktop.png'), fullPage: false });
  await page.getByRole('button', { name: '用于下次创作' }).click();
  await page.getByText('已用于下次创作', { exact: true }).waitFor();

  const snapshots = await api(`/api/contents/${currentContent.id}/performance`);
  if (!snapshots.snapshots[0]?.receiptId && receiptId) {
    // UI manual entry is allowed without a receipt; the verified receipt remains independently queryable.
    const receipt = await api(`/api/delivery-receipts/${receiptId}`);
    if (!receipt.receipt.verified) throw new Error('草稿回执未验证');
  }
  const rules = await api('/api/learning-rules');
  if (!rules.rules.some((rule) => rule.status === 'active')) throw new Error('批准后的经验没有进入策略上下文');

  await page.getByRole('button', { name: '开始创作' }).click();
  await page.getByLabel('新建文案').click();
  const nextComposer = page.getByPlaceholder(/描述你想写的内容/);
  await nextComposer.fill(`产品名是 ${productName}，${productName} 可以读取代码仓库并运行测试。再写一篇面向独立开发者的小红书产品介绍。`);
  await page.getByRole('button', { name: '生成文案' }).click();
  await page.getByText('已确认的创作经验', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '本次不采用' }).first().waitFor({ timeout: 30_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  if (overflow) throw new Error('移动端存在横向页面溢出');
  await waitForTransientUi(page);
  await page.screenshot({ path: path.join(screenshots, '05-learning-mobile.png'), fullPage: false });

  if (browserErrors.length) throw new Error(`浏览器错误: ${browserErrors.join(' | ')}`);
  console.log(JSON.stringify({
    materialSet: true,
    contentId: currentContent.id,
    contentRevision: currentContent.revision,
    deliveryStatus: jobs.jobs[0].status,
    receiptId,
    performanceSnapshots: snapshots.snapshots.length,
    activeLearningRules: rules.rules.filter((rule) => rule.status === 'active').length,
    mobileOverflow: overflow,
    screenshots,
  }, null, 2));
} finally {
  await browser.close();
}
