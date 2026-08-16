import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const baseUrl = process.env.CONTENTFLOW_WEB_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : undefined),
  args: ['--disable-gpu'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 20000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const composer = page.getByPlaceholder(/描述你想写的内容/);
  await composer.fill('产品名是 CodeLoop，面向个人开发者的 AI 编码 Agent，可以读取代码仓库、修改代码并运行测试。请写一篇小红书产品介绍。');
  await page.getByRole('button', { name: '生成文案' }).click();
  await page.getByRole('heading', { name: '选择这篇文案怎么切入' }).waitFor({ timeout: 20000 });

  let generationRequests = 0;
  await page.route('**/api/content-operations', async (route) => {
    generationRequests += 1;
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'SERVICE_UNAVAILABLE', error: '处理失败，请重试' }),
    });
  });

  const choose = page.getByRole('button', { name: '用这个方向' }).first();
  await choose.evaluate((button) => {
    button.click();
    button.click();
  });

  const errorText = '创作服务暂时未连接，请稍后重试。系统已自动尝试恢复，内容方向已保留。';
  await page.getByText(errorText, { exact: true }).waitFor({ timeout: 10000 });
  assert.equal(generationRequests, 2, '一次操作只允许原始请求加一次内部重试');
  assert.equal(await page.getByText(errorText, { exact: true }).count(), 1, '同类错误只能显示一条');
  assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
  console.log('strategy error e2e passed');
} finally {
  await browser.close();
}
