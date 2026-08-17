import test from 'node:test';
import assert from 'node:assert/strict';
import { getCircuitStatus, listRuntimeEvents, resetAdapterRuntime, runAdapterOperation } from '../server/adapter-runtime.js';
import { createDeliveryJob, createPublishPackages, createSandboxDraftAdapter, waitForDeliveryJob } from '../server/publish-delivery.js';
import { resetRoadmapStore } from '../server/roadmap-store.js';
import { resetStore, saveContent } from '../server/store.js';

test.beforeEach(async () => {
  process.env.CONTENTFLOW_MODEL_MODE = 'local';
  resetAdapterRuntime();
  await resetStore();
  await resetRoadmapStore();
});

async function content() {
  return saveContent({
    name: '可靠性演练内容',
    platform: 'xiaohongshu',
    titleCandidates: ['把编码任务交给 Agent'],
    bodyMarkdown: 'CodeLoop 可以读取授权仓库、修改代码并运行项目测试。',
    topics: ['AI编程'],
  });
}

test('外部适配器事件只记录元数据并在连续失败后熔断', async () => {
  let calls = 0;
  const fail = () => runAdapterOperation({
    adapterKey: 'delivery:xiaohongshu',
    adapterVersion: 'dom-2026.08',
    action: 'create_draft',
    operationId: 'job_reliability',
    execute: async () => { calls += 1; throw Object.assign(new Error('selector changed: private body must not be logged'), { code: 'PLATFORM_DOM_CHANGED' }); },
  });
  await assert.rejects(fail, (error) => error.code === 'PLATFORM_DOM_CHANGED');
  await assert.rejects(fail, (error) => error.code === 'PLATFORM_DOM_CHANGED');
  await assert.rejects(fail, (error) => error.code === 'PLATFORM_DOM_CHANGED');
  await assert.rejects(fail, (error) => error.code === 'ADAPTER_CIRCUIT_OPEN');
  assert.equal(calls, 3);
  assert.equal(getCircuitStatus('delivery:xiaohongshu').state, 'open');
  const events = await listRuntimeEvents({ adapterKey: 'delivery:xiaohongshu' });
  assert.ok(events.some((event) => event.type === 'adapter.failed' && event.errorCode === 'PLATFORM_DOM_CHANGED'));
  assert.ok(events.some((event) => event.type === 'adapter.blocked'));
  assert.doesNotMatch(JSON.stringify(events), /private body must not be logged|selector changed/);
});

test('登录过期进入等待登录，不调用草稿提交', async () => {
  const saved = await content();
  const [pkg] = await createPublishPackages({ contentId: saved.id, platforms: ['xiaohongshu'], assets: [{ assetId: 'cover', type: 'image' }] });
  let submissions = 0;
  const adapter = {
    capabilities: async () => ({ draft: true, directPublish: false, verifyDraft: true, requiresSession: true, adapterVersion: 'test-login-1' }),
    checkSession: async () => ({ status: 'expired', loginUrl: 'https://example.invalid/login' }),
    createDraft: async () => { submissions += 1; },
    verify: async () => ({ verified: false }),
  };
  const queued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => adapter });
  const job = await waitForDeliveryJob(queued.jobId, { adapterResolver: () => adapter });
  assert.equal(job.status, 'waiting_session');
  assert.equal(job.items[0].session.status, 'expired');
  assert.equal(submissions, 0);
});

test('单个平台 DOM 变化失败不影响其他平台完成', async () => {
  const saved = await content();
  const packages = await createPublishPackages({
    contentId: saved.id,
    platforms: ['xiaohongshu', 'zhihu'],
    assets: [{ assetId: 'cover', type: 'image' }],
  });
  const healthy = createSandboxDraftAdapter();
  const changed = {
    capabilities: async () => ({ draft: true, directPublish: false, verifyDraft: true, requiresSession: false, adapterVersion: 'dom-old' }),
    checkSession: async () => ({ status: 'ready' }),
    createDraft: async () => { throw Object.assign(new Error('页面结构已变化'), { code: 'PLATFORM_DOM_CHANGED' }); },
    verify: async () => ({ verified: false }),
  };
  const queued = await createDeliveryJob(packages.map((item) => item.packageId), { adapterResolver: (platform) => platform === 'xiaohongshu' ? changed : healthy });
  const job = await waitForDeliveryJob(queued.jobId, { adapterResolver: (platform) => platform === 'xiaohongshu' ? changed : healthy });
  assert.equal(job.status, 'partial');
  assert.equal(job.items.find((item) => item.platform === 'xiaohongshu').errorCode, 'PLATFORM_DOM_CHANGED');
  assert.equal(job.items.find((item) => item.platform === 'zhihu').status, 'delivered');
});

test('内容自动保存存储 P95 小于 800ms', async () => {
  const durations = [];
  let current = await content();
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    current = await saveContent({
      id: current.id,
      baseRevision: current.revision,
      platform: 'xiaohongshu',
      titleCandidates: ['把编码任务交给 Agent'],
      bodyMarkdown: `CodeLoop 可以读取授权仓库、修改代码并运行项目测试。版本 ${index}`,
      topics: ['AI编程'],
    });
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  assert.ok(p95 < 800, `自动保存 P95 ${p95.toFixed(1)}ms 超过 800ms`);
});
