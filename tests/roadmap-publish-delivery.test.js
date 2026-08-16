import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resetStore, saveContent } from '../server/store.js';
import { resetRoadmapStore } from '../server/roadmap-store.js';
import { cancelDeliveryJob, createDeliveryJob, createPublishPackages, createSandboxDraftAdapter, deleteDeliveryForContent, getDeliveryJob, getDeliveryReceipt, listDeliveryJobs, listPublishPackages, preflightPublishPackage, retryDeliveryJob, waitForDeliveryJob } from '../server/publish-delivery.js';

test.beforeEach(async () => { await resetStore(); await resetRoadmapStore(); });

async function codeLoopContent() {
  return saveContent({
    name: 'CodeLoop 产品介绍',
    platform: 'xiaohongshu',
    titleCandidates: ['把编码任务交给 Agent'],
    selectedTitleIndex: 0,
    bodyMarkdown: 'CodeLoop 可以读取授权仓库、拆解任务、修改代码并运行项目测试。',
    topics: ['AI编程', '独立开发', '开发工具'],
  });
}

test('PR-03 发布包绑定不可变内容版本并执行平台 preflight', async () => {
  const content = await codeLoopContent();
  const [pkg] = await createPublishPackages({
    contentId: content.id,
    contentRevision: 1,
    platforms: ['xiaohongshu'],
    assets: [{ assetId: 'cover', type: 'image', role: 'cover', order: 1 }],
  });
  assert.equal(pkg.contentRevision, 1);
  assert.equal(pkg.target, 'draft');
  assert.equal(pkg.fields.title, '把编码任务交给 Agent');
  const preflight = await preflightPublishPackage(pkg);
  assert.equal(preflight.status, 'pass');
  assert.equal(preflight.checks.every((item) => item.status === 'pass'), true);

  const [withoutImage] = await createPublishPackages({ contentId: content.id, contentRevision: 1, platforms: ['xiaohongshu'] });
  assert.equal((await preflightPublishPackage(withoutImage)).status, 'blocked');
});

test('PR-03 跨平台发布包经过内容引擎适配而不是直接复制字段', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'local';
  try {
    const content = await codeLoopContent();
    const [pkg] = await createPublishPackages({ contentId: content.id, platforms: ['wechat'] });
    assert.equal(pkg.platform, 'wechat');
    assert.equal(pkg.adaptation.status, 'generated');
    assert.equal(pkg.adaptation.sourcePlatform, 'xiaohongshu');
    assert.ok(pkg.platformSpecVersion);
    assert.ok(pkg.fields.title);
    assert.ok(pkg.fields.body);
  } finally {
    if (previousMode === undefined) delete process.env.CONTENTFLOW_MODEL_MODE;
    else process.env.CONTENTFLOW_MODEL_MODE = previousMode;
  }
});

test('PR-03 草稿交付只有经过反查才能显示 delivered', async () => {
  const content = await codeLoopContent();
  const [pkg] = await createPublishPackages({ contentId: content.id, platforms: ['xiaohongshu'], assets: [{ assetId: 'cover', type: 'image', role: 'cover' }] });
  const adapter = createSandboxDraftAdapter(path.resolve('.test-data', String(process.pid), 'delivery-contract'));
  const queued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => adapter });
  assert.equal(queued.status, 'queued');
  const job = await waitForDeliveryJob(queued.jobId, { adapterResolver: () => adapter });
  assert.equal(job.status, 'delivered');
  assert.equal(job.items[0].status, 'delivered');
  const receipt = await getDeliveryReceipt(job.items[0].receiptId);
  assert.equal(receipt.verified, true);
  assert.equal(receipt.verificationMethod, 'sandbox_draft_list_lookup');
  assert.ok(receipt.remoteDraftId);
});

test('PR-03 重复提交同一发布包复用幂等草稿', async () => {
  const content = await codeLoopContent();
  const [pkg] = await createPublishPackages({ contentId: content.id, platforms: ['xiaohongshu'], assets: [{ assetId: 'cover', type: 'image' }] });
  const adapter = createSandboxDraftAdapter(path.resolve('.test-data', String(process.pid), 'delivery-idempotency'));
  const firstQueued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => adapter });
  const first = await waitForDeliveryJob(firstQueued.jobId, { adapterResolver: () => adapter });
  const secondQueued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => adapter });
  const second = await waitForDeliveryJob(secondQueued.jobId, { adapterResolver: () => adapter });
  const firstReceipt = await getDeliveryReceipt(first.items[0].receiptId);
  const secondReceipt = await getDeliveryReceipt(second.items[0].receiptId);
  assert.equal(firstReceipt.remoteDraftId, secondReceipt.remoteDraftId);
});

test('PR-03 第三张素材失败后从检查点继续，不重传已确认资源', async () => {
  const content = await codeLoopContent();
  const [pkg] = await createPublishPackages({
    contentId: content.id,
    platforms: ['xiaohongshu'],
    assets: ['cover', 'flow', 'test'].map((assetId, index) => ({ assetId, type: 'image', order: index + 1 })),
  });
  const calls = [];
  let failThird = true;
  const adapter = {
    capabilities: async () => ({ draft: true, directPublish: false, verifyDraft: true, requiresSession: false, resumableAssets: true, adapterVersion: 'resume-1' }),
    checkSession: async () => ({ status: 'ready' }),
    uploadAsset: async (_package, asset) => {
      calls.push(asset.assetId);
      if (asset.assetId === 'test' && failThird) {
        failThird = false;
        throw Object.assign(new Error('第三张图上传失败'), { code: 'ASSET_UPLOAD_FAILED' });
      }
      return { remoteAssetId: `remote_${asset.assetId}` };
    },
    createDraft: async (deliveryPackage) => {
      assert.equal(deliveryPackage.assets.every((asset) => asset.remoteAsset?.remoteAssetId), true);
      return { remoteDraftId: 'draft_resume_1' };
    },
    verify: async () => ({ verified: true, verificationMethod: 'draft_list_lookup' }),
  };
  const queued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => adapter });
  const failed = await waitForDeliveryJob(queued.jobId, { adapterResolver: () => adapter });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(Object.keys(failed.items[0].checkpoint.uploadedAssets), ['cover', 'flow']);
  await retryDeliveryJob(queued.jobId, { adapterResolver: () => adapter });
  const delivered = await waitForDeliveryJob(queued.jobId, { adapterResolver: () => adapter });
  assert.equal(delivered.status, 'delivered');
  assert.deepEqual(calls, ['cover', 'flow', 'test', 'test']);
});

test('PR-03 取消正在提交的任务会中断连接器，且后台不会覆盖取消状态', async () => {
  const content = await codeLoopContent();
  const [pkg] = await createPublishPackages({ contentId: content.id, platforms: ['xiaohongshu'], assets: [{ assetId: 'cover', type: 'image' }] });
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const adapter = {
    capabilities: async () => ({ draft: true, directPublish: false, verifyDraft: true, requiresSession: false, adapterVersion: 'cancel-1' }),
    checkSession: async () => ({ status: 'ready' }),
    createDraft: async (_package, _key, { signal }) => new Promise((resolve, reject) => {
      startedResolve();
      signal.addEventListener('abort', () => reject(Object.assign(new Error('已取消'), { name: 'AbortError' })), { once: true });
    }),
    verify: async () => ({ verified: true, verificationMethod: 'draft_list_lookup' }),
  };
  const queued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => adapter });
  await started;
  const cancelled = await cancelDeliveryJob(queued.jobId);
  assert.equal(cancelled.status, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const persisted = await getDeliveryJob(queued.jobId);
  assert.equal(persisted.status, 'cancelled');
  assert.equal(persisted.items[0].status, 'cancelled');
  assert.equal(persisted.items[0].receiptId, null);
});

test('PR-03 未配置生产连接器时不伪造平台送达成功', async () => {
  const content = await codeLoopContent();
  const [pkg] = await createPublishPackages({ contentId: content.id, platforms: ['xiaohongshu'], assets: [{ assetId: 'cover', type: 'image' }] });
  const queued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => null });
  const job = await waitForDeliveryJob(queued.jobId, { adapterResolver: () => null });
  assert.equal(job.status, 'waiting_session');
  assert.equal(job.items[0].receiptId, null);
  assert.match(job.items[0].userMessage, /没有可用的平台连接器/);
});

test('PR-03 直接发布必须二次确认且适配器明确支持', async () => {
  const content = await codeLoopContent();
  await assert.rejects(
    () => createPublishPackages({ contentId: content.id, platforms: ['xiaohongshu'], target: 'published', assets: [{ assetId: 'cover', type: 'image' }] }),
    (error) => error.code === 'DIRECT_PUBLISH_CONFIRMATION_REQUIRED' && error.status === 409,
  );

  const [pkg] = await createPublishPackages({
    contentId: content.id,
    platforms: ['xiaohongshu'],
    target: 'published',
    directPublishConfirmed: true,
    assets: [{ assetId: 'cover', type: 'image' }],
  });
  assert.equal((await preflightPublishPackage(pkg)).status, 'blocked');

  let publishCalls = 0;
  const adapter = {
    capabilities: async () => ({ draft: true, directPublish: true, verifyDraft: true, requiresSession: false }),
    checkSession: async () => ({ status: 'ready' }),
    publish: async () => { publishCalls += 1; return { remoteDraftId: 'published_01', adapterVersion: 'test-direct-1' }; },
    verify: async () => ({ verified: true, verificationMethod: 'url_lookup' }),
  };
  const queued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => adapter });
  const job = await waitForDeliveryJob(queued.jobId, { adapterResolver: () => adapter });
  assert.equal(job.status, 'delivered');
  assert.equal(publishCalls, 1);
  const receipt = await getDeliveryReceipt(job.items[0].receiptId);
  assert.equal(receipt.target, 'published');
  assert.equal(receipt.verified, true);
});

test('PR-03 删除内容关联交付数据时清理发布包、任务和回执', async () => {
  const content = await codeLoopContent();
  const [pkg] = await createPublishPackages({ contentId: content.id, platforms: ['xiaohongshu'], assets: [{ assetId: 'cover', type: 'image' }] });
  const adapter = createSandboxDraftAdapter(path.resolve('.test-data', String(process.pid), 'delivery-delete'));
  const queued = await createDeliveryJob([pkg.packageId], { adapterResolver: () => adapter });
  const delivered = await waitForDeliveryJob(queued.jobId, { adapterResolver: () => adapter });
  const receiptId = delivered.items[0].receiptId;
  const removed = await deleteDeliveryForContent(content.id);
  assert.deepEqual(removed, { publishPackages: 1, deliveryJobs: 1, deliveryReceipts: 1 });
  assert.equal((await listPublishPackages()).length, 0);
  assert.equal((await listDeliveryJobs()).length, 0);
  assert.equal(await getDeliveryReceipt(receiptId), null);
});
