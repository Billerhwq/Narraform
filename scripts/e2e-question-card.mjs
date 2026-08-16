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
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (entry) => { if (entry.type() === 'error') errors.push(entry.text()); });

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle', timeout: 15000 });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('contentflow-chat-cleared-20260815', '1');
  localStorage.setItem('contentflow-v1-draft', JSON.stringify({
    platform: 'xiaohongshu',
    tone: '干货拆解',
    dirty: false,
    pendingInstruction: '写一篇产品介绍',
    taskBrief: { status: 'needs_input' },
    messages: [
      { id: 'question-user', role: 'user', text: '写一篇产品介绍' },
      { id: 'question-assistant', role: 'assistant', type: 'question', text: '你希望写到具体成果，但现有信息里没有可核对的数据。请提供真实数据，或确认改成不含数据的表达。' },
    ],
    result: null,
  }));
});
await page.reload({ waitUntil: 'networkidle' });

fs.mkdirSync(path.resolve('screenshots'), { recursive: true });
const card = page.locator('.assistant-message.question .message-body');
await card.waitFor({ state: 'visible' });
const desktop = await page.evaluate(() => {
  const cardNode = document.querySelector('.assistant-message.question .message-body');
  const message = document.querySelector('.assistant-message.question');
  return {
    cardWidth: cardNode.getBoundingClientRect().width,
    messageWidth: message.getBoundingClientRect().width,
    kicker: cardNode.querySelector('.question-kicker')?.textContent.trim(),
    noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
  };
});
await page.screenshot({ path: path.resolve('screenshots', 'question-card-desktop.png'), animations: 'disabled' });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
const mobile = await page.evaluate(() => ({
  cardWidth: document.querySelector('.assistant-message.question .message-body').getBoundingClientRect().width,
  noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
}));
await page.screenshot({ path: path.resolve('screenshots', 'question-card-mobile.png'), animations: 'disabled' });

const result = {
  desktopWidthConstrained: desktop.cardWidth <= 722 && desktop.cardWidth < desktop.messageWidth,
  desktopKickerVisible: desktop.kicker === '还缺一项信息',
  desktopNoOverflow: desktop.noOverflow,
  mobileFitsViewport: mobile.cardWidth < 390,
  mobileNoOverflow: mobile.noOverflow,
  errors,
};
console.log(JSON.stringify(result, null, 2));
await browser.close();

if (Object.values(result).slice(0, 5).some((value) => value !== true) || errors.length) process.exit(1);
