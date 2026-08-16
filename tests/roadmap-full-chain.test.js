import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStore } from '../server/store.js';
import { resetRoadmapStore } from '../server/roadmap-store.js';

let server;
let baseUrl;
let app;
const previousModelMode = process.env.CONTENTFLOW_MODEL_MODE;
const previousDeliveryMode = process.env.NARRAFORM_DELIVERY_MODE;

async function json(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `${response.status} ${path}: ${JSON.stringify(payload)}`);
  return payload;
}

test.before(async () => {
  process.env.CONTENTFLOW_MODEL_MODE = 'local';
  process.env.NARRAFORM_DELIVERY_MODE = 'sandbox';
  app = (await import('../server/index.js')).default;
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', () => { baseUrl = `http://127.0.0.1:${server.address().port}`; resolve(); }); });
});

test.beforeEach(async () => { await resetStore(); await resetRoadmapStore(); });

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (previousModelMode === undefined) delete process.env.CONTENTFLOW_MODEL_MODE; else process.env.CONTENTFLOW_MODEL_MODE = previousModelMode;
  if (previousDeliveryMode === undefined) delete process.env.NARRAFORM_DELIVERY_MODE; else process.env.NARRAFORM_DELIVERY_MODE = previousDeliveryMode;
});

test('总体闭环：素材 → 策略 → 内容 → 草稿回执 → 表现 → 经验 → 下一次策略', async () => {
  const createdSet = await json('/api/material-sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: 'CodeLoop 是一个协助完成编码任务的 Agent。' }) });
  const materialSetId = createdSet.materialSet.materialSetId;
  const queuedMaterials = await json(`/api/material-sets/${materialSetId}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ type: 'user_text', text: 'CodeLoop 可以读取用户授权的代码仓库。CodeLoop 会把编码目标拆解为执行计划。CodeLoop 可以修改代码并运行项目测试。' }] }) });
  assert.equal(queuedMaterials.materialSet.status, 'processing');
  let materialJob;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    materialJob = (await json(`/api/material-analysis-jobs/${queuedMaterials.job.jobId}`)).job;
    if (['completed', 'partial'].includes(materialJob.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(materialJob.status, 'completed');
  const materials = await json(`/api/material-sets/${materialSetId}`);
  assert.equal(materials.materialSet.analysis.userClaims.length, 4);

  const understood = await json('/api/tasks/understand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ materialSetId, platform: 'xiaohongshu', instruction: '产品名是 CodeLoop，面向独立开发者写一篇自然的小红书产品介绍，不虚构效果。' }) });
  assert.equal(understood.status, 'awaiting_strategy');
  assert.equal(understood.taskBrief.strategyOptions.length, 3);
  const strategyId = understood.taskBrief.strategyOptions[0].id;
  await json(`/api/tasks/${understood.taskBrief.taskId}/select-strategy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategyId }) });
  const generated = await json('/api/content-operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'generate', taskId: understood.taskBrief.taskId, strategyId, platform: 'xiaohongshu' }) });
  assert.equal(generated.status, 'completed');
  assert.ok(generated.result.bodyMarkdown.length > 100);

  const saved = await json('/api/contents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'CodeLoop 产品介绍', platform: 'xiaohongshu', materialSetId, ...generated.result }) });
  assert.equal(saved.content.revision, 1);
  const contentId = saved.content.id;
  const packages = await json('/api/publish-packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId, contentRevision: 1, platforms: ['xiaohongshu'], assets: [{ assetId: 'cover', type: 'image', role: 'cover' }] }) });
  const preflight = await json(`/api/publish-packages/${packages.packages[0].packageId}/preflight`, { method: 'POST' });
  assert.equal(preflight.preflight.status, 'pass');
  const delivery = await json('/api/delivery-jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packageIds: [packages.packages[0].packageId] }) });
  assert.equal(delivery.job.status, 'queued');
  let deliveryJob;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    deliveryJob = (await json(`/api/delivery-jobs/${delivery.job.jobId}`)).job;
    if (['delivered', 'partial', 'failed', 'waiting_session', 'uncertain'].includes(deliveryJob.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(deliveryJob.status, 'delivered');
  const receipt = await json(`/api/delivery-receipts/${deliveryJob.items[0].receiptId}`);
  assert.equal(receipt.receipt.verified, true);

  for (let index = 0; index < 5; index += 1) {
    const baseline = await json('/api/contents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `同类基线 ${index + 1}`, platform: 'xiaohongshu', bodyMarkdown: '同类内容正文', titleCandidates: [`同类标题 ${index + 1}`], strategySnapshot: { goal: 'save', contentType: 'product_marketing' } }) });
    await json('/api/performance-snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId: baseline.content.id, contentRevision: 1, platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, source: 'manual', metrics: { reads: 10000, saves: 300 + index * 10 } }) });
  }
  const snapshot = await json('/api/performance-snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contentId, contentRevision: 1, receiptId: receipt.receipt.receiptId, platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, source: 'manual', metrics: { impressions: 18420, reads: 15107, likes: 612, saves: 941, comments: 83 } }) });
  const retrospective = await json(`/api/contents/${contentId}/retrospective`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshotId: snapshot.snapshot.snapshotId }) });
  assert.equal(retrospective.baseline.status, 'available');
  assert.equal(retrospective.insight.causalClaim, false);
  await json(`/api/learning-rules/${retrospective.insight.insightId}/approve`, { method: 'POST' });

  const nextTask = await json('/api/tasks/understand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'xiaohongshu', instruction: '产品名是 CodeLoop，CodeLoop 可以读取仓库并运行测试。再写一篇面向独立开发者的小红书产品介绍。' }) });
  assert.ok(nextTask.taskBrief.learningRulesApplied.length >= 1);
  assert.ok(nextTask.taskBrief.strategyOptions.every((strategy) => strategy.learningRuleIds.length >= 1));
  const ruleId = nextTask.taskBrief.learningRulesApplied[0].ruleId;
  const excluded = await json(`/api/tasks/${nextTask.taskBrief.taskId}/learning-rules/${ruleId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
  assert.equal(excluded.taskBrief.learningRulesApplied.some((rule) => rule.ruleId === ruleId), false);
  assert.ok(excluded.taskBrief.strategyOptions.every((strategy) => !strategy.learningRuleIds.includes(ruleId)));
  const restored = await json(`/api/tasks/${nextTask.taskBrief.taskId}/learning-rules/${ruleId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
  assert.equal(restored.taskBrief.learningRulesApplied.some((rule) => rule.ruleId === ruleId), true);
});
