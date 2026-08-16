import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getContent, getTask } from './store.js';
import { deleteEntity, getEntity, listEntities, putEntity, updateEntity } from './roadmap-store.js';
import { resolvePlatformSpec } from './platform-specs.js';
import { buildFactSet, modifyCopy } from './content-engine.js';
import { runAdapterOperation } from './adapter-runtime.js';

const SUPPORTED_PLATFORMS = new Set(['xiaohongshu', 'zhihu', 'wechat']);
const PLATFORM_LABELS = { xiaohongshu: '小红书', zhihu: '知乎', wechat: '微信公众号' };
const deliveryRuns = new Map();
const deliveryControllers = new Map();
function now() { return new Date().toISOString(); }
function deliveryError(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; return error; }
function idempotencyKey(pkg) { return crypto.createHash('sha256').update(`${pkg.packageId}:${pkg.platform}:${pkg.target}`).digest('hex'); }

function selectedTitle(version) {
  return version.titleCandidates?.[version.selectedTitleIndex || 0] || version.titleCandidates?.[0] || '';
}

function fieldsForPlatform(platform, version, override = {}) {
  const title = override.title ?? selectedTitle(version);
  const body = override.body ?? version.bodyMarkdown ?? '';
  if (platform === 'xiaohongshu') return { title, body, topics: override.topics ?? version.topics ?? [] };
  if (platform === 'zhihu') {
    const mode = override.mode || version.platformMode || 'article';
    return mode === 'answer'
      ? { mode, questionUrl: override.questionUrl || '', questionTitle: override.questionTitle || version.questionTitle || '', body, topics: override.topics ?? version.topics ?? [] }
      : { mode, title, summary: override.summary ?? version.summary ?? '', body, topics: override.topics ?? version.topics ?? [] };
  }
  return { title, digest: override.digest ?? version.summary ?? '', body, author: override.author || '' };
}

export async function createPublishPackages({ contentId, contentRevision, platforms = [], target = 'draft', directPublishConfirmed = false, overrides = {}, assets = [] }) {
  if (target !== 'draft' && target !== 'published') throw deliveryError('PUBLISH_TARGET_UNSUPPORTED', '发布目标只能是草稿或直接发布');
  if (target === 'published' && directPublishConfirmed !== true) throw deliveryError('DIRECT_PUBLISH_CONFIRMATION_REQUIRED', '直接发布需要再次明确确认', 409);
  const content = await getContent(contentId);
  if (!content) throw deliveryError('CONTENT_NOT_FOUND', '没有找到要发布的内容', 404);
  const revision = Number(contentRevision || content.revision || content.versions.length);
  const version = content.versions.find((item) => Number(item.revision) === revision) || (revision === content.versions.length ? content.versions[revision - 1] : null);
  if (!version) throw deliveryError('CONTENT_VERSION_NOT_FOUND', '没有找到要发布的内容版本', 404);
  const requestedPlatforms = [...new Set(platforms.length ? platforms : [version.platform])];
  if (requestedPlatforms.some((platform) => !SUPPORTED_PLATFORMS.has(platform))) throw deliveryError('PLATFORM_UNSUPPORTED', '当前只支持小红书、知乎和微信公众号发布包');
  const createdAt = now();
  const packages = [];
  const taskBrief = version.taskId ? await getTask(version.taskId) : null;
  for (const platform of requestedPlatforms) {
    let platformVersion = version;
    let adaptation = { sourcePlatform: version.platform || content.platform, status: platform === (version.platform || content.platform) ? 'original' : 'generated', provider: version.provider || null };
    if (platform !== (version.platform || content.platform)) {
      const factSet = taskBrief
        ? { verifiedFacts: taskBrief.facts || [], facts: taskBrief.facts || [], opinions: taskBrief.opinions || [], experiences: taskBrief.experiences || [], conflicts: [], unknowns: taskBrief.unknowns || [], knownNumbers: [] }
        : buildFactSet({ instruction: version.bodyMarkdown || '', materials: [] });
      const label = platform === 'zhihu' ? '知乎文章' : PLATFORM_LABELS[platform];
      const adapted = await modifyCopy({
        platform: version.platform || content.platform,
        platformMode: version.platformMode,
        targetPlatform: platform,
        taskBrief: taskBrief ? { ...taskBrief, status: 'ready_to_generate' } : undefined,
        factSet,
        instruction: taskBrief?.instruction || version.bodyMarkdown,
        modification: `改成${label}版本，只使用当前内容中的事实，按目标平台结构重新组织`,
        currentCopy: version.bodyMarkdown || '',
        titleCandidates: version.titleCandidates || [],
        selectedTitleIndex: version.selectedTitleIndex || 0,
        summary: version.summary,
        topics: version.topics || [],
      });
      platformVersion = adapted.result;
      adaptation = { ...adaptation, provider: adapted.result.provider || 'local-transform', sourceSpecVersion: version.platformSpecVersion || version.specVersion || null };
    }
    const mode = overrides[platform]?.mode || platformVersion.platformMode;
    packages.push({
      packageId: `pkg_${crypto.randomUUID()}`,
      contentId,
      contentRevision: revision,
      platform,
      platformLabel: PLATFORM_LABELS[platform],
      target,
      directPublishConfirmed: target === 'published',
      fields: fieldsForPlatform(platform, platformVersion, overrides[platform] || {}),
      assets: assets.filter((asset) => !asset.platform || asset.platform === platform).map((asset, index) => ({ ...asset, order: asset.order || index + 1 })),
      platformSpecVersion: platformVersion.platformSpecVersion || platformVersion.specVersion || resolvePlatformSpec(platform, mode).version,
      adaptation,
      createdAt,
      immutable: true,
    });
  }
  for (const pkg of packages) await putEntity('publishPackages', pkg, 'packageId');
  return packages;
}

export async function listPublishPackages() {
  return (await listEntities('publishPackages')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getPublishPackage(packageId) {
  return getEntity('publishPackages', packageId, 'packageId');
}

function check(id, status, message, field = null) { return { id, status, message, field }; }

export async function preflightPublishPackage(packageOrId, capabilities = null) {
  const pkg = typeof packageOrId === 'string' ? await getPublishPackage(packageOrId) : packageOrId;
  if (!pkg) throw deliveryError('PUBLISH_PACKAGE_NOT_FOUND', '没有找到发布包', 404);
  const checks = [];
  const { fields, assets, platform } = pkg;
  const resolvedCapabilities = capabilities || adapterCapabilities();
  if (pkg.target === 'published') {
    checks.push(check('direct_publish_confirmation', pkg.directPublishConfirmed ? 'pass' : 'blocked', pkg.directPublishConfirmed ? '已完成直接发布二次确认' : '直接发布尚未二次确认'));
    checks.push(check('direct_publish_capability', resolvedCapabilities.directPublish ? 'pass' : 'blocked', resolvedCapabilities.directPublish ? '平台连接器支持直接发布' : '当前连接器不支持直接发布'));
  }
  if (platform === 'xiaohongshu') {
    checks.push(check('xhs_title_required', fields.title?.trim() ? 'pass' : 'blocked', fields.title?.trim() ? '标题已填写' : '需要填写标题', 'title'));
    checks.push(check('xhs_title_length', [...(fields.title || '')].length <= 20 ? 'pass' : 'blocked', [...(fields.title || '')].length <= 20 ? '标题长度符合建议范围' : '小红书标题不能超过 20 个字符', 'title'));
    checks.push(check('xhs_body_required', fields.body?.trim() ? 'pass' : 'blocked', fields.body?.trim() ? '正文已填写' : '需要填写正文', 'body'));
    checks.push(check('xhs_topic_count', fields.topics?.length <= 8 ? 'pass' : 'blocked', fields.topics?.length <= 8 ? `共 ${fields.topics?.length || 0} 个话题` : '小红书话题不能超过 8 个', 'topics'));
    checks.push(check('xhs_image_count', assets.length >= 1 && assets.length <= 18 ? 'pass' : 'blocked', assets.length ? `共 ${assets.length} 张图片` : '小红书图文需要至少 1 张图片', 'assets'));
  }
  if (platform === 'zhihu') {
    const answer = fields.mode === 'answer';
    checks.push(check('zhihu_destination', answer ? (fields.questionUrl ? 'pass' : 'blocked') : (fields.title ? 'pass' : 'blocked'), answer ? (fields.questionUrl ? '已关联知乎问题' : '知乎回答需要问题链接') : (fields.title ? '文章标题已填写' : '知乎文章需要标题'), answer ? 'questionUrl' : 'title'));
    checks.push(check('zhihu_body_required', fields.body?.trim() ? 'pass' : 'blocked', fields.body?.trim() ? '正文已填写' : '需要填写正文', 'body'));
  }
  if (platform === 'wechat') {
    checks.push(check('wechat_title_required', fields.title?.trim() ? 'pass' : 'blocked', fields.title?.trim() ? '标题已填写' : '公众号需要标题', 'title'));
    checks.push(check('wechat_body_required', fields.body?.trim() ? 'pass' : 'blocked', fields.body?.trim() ? '正文已填写' : '公众号需要正文', 'body'));
    checks.push(check('wechat_cover', assets.some((asset) => asset.role === 'cover') ? 'pass' : 'warning', assets.some((asset) => asset.role === 'cover') ? '封面已准备' : '建议添加公众号封面', 'assets'));
  }
  const blocked = checks.some((item) => item.status === 'blocked');
  const warning = checks.some((item) => item.status === 'warning');
  return { packageId: pkg.packageId, status: blocked ? 'blocked' : warning ? 'warning' : 'pass', checks, capabilities: resolvedCapabilities };
}

function adapterCapabilities() {
  const webhook = Boolean(process.env.NARRAFORM_DELIVERY_ADAPTER_URL);
  const sandbox = process.env.NARRAFORM_DELIVERY_MODE === 'sandbox' || process.env.NODE_ENV === 'test';
  return { draft: webhook || sandbox, directPublish: false, verifyDraft: webhook || sandbox, requiresSession: !webhook && !sandbox, adapterVersion: sandbox ? 'sandbox-1.0.0' : webhook ? 'external' : null };
}

export function createSandboxDraftAdapter(directory = path.resolve('.test-data', 'platform-drafts')) {
  return {
    capabilities: async () => ({ draft: true, directPublish: false, verifyDraft: true, requiresSession: false, resumableAssets: true, adapterVersion: 'sandbox-1.1.0' }),
    checkSession: async () => ({ status: 'ready' }),
    startLogin: async () => ({ status: 'ready', message: '沙箱模式不需要登录' }),
    uploadAsset: async (_pkg, asset, key, { signal } = {}) => {
      if (signal?.aborted) throw Object.assign(new Error('发布任务已取消'), { code: 'DELIVERY_CANCELLED', status: 499 });
      return { remoteAssetId: `${key}:${asset.assetId}`, assetId: asset.assetId };
    },
    createDraft: async (pkg, key, { signal } = {}) => {
      if (signal?.aborted) throw Object.assign(new Error('发布任务已取消'), { code: 'DELIVERY_CANCELLED', status: 499 });
      await fs.mkdir(directory, { recursive: true });
      const existing = (await fs.readdir(directory)).find((file) => file.startsWith(`${key}.`));
      if (existing) return { remoteDraftId: path.basename(existing, '.json'), path: path.join(directory, existing), idempotentReplay: true };
      const remoteDraftId = `${key}.${pkg.platform}`;
      const file = path.join(directory, `${remoteDraftId}.json`);
      await fs.writeFile(file, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      return { remoteDraftId, path: file, idempotentReplay: false };
    },
    verify: async (result) => {
      try { await fs.access(result.path); return { verified: true, verificationMethod: 'sandbox_draft_list_lookup' }; }
      catch { return { verified: false, verificationMethod: null }; }
    },
  };
}

function webhookAdapter() {
  const endpoint = process.env.NARRAFORM_DELIVERY_ADAPTER_URL;
  const key = process.env.NARRAFORM_DELIVERY_ADAPTER_KEY;
  if (!endpoint) return null;
  const call = async (action, payload, signal) => {
    const timeout = AbortSignal.timeout(120_000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(payload), signal: combinedSignal });
    if (!response.ok) throw deliveryError('DELIVERY_ADAPTER_FAILED', `发布连接器返回 ${response.status}`, 502);
    return response.json();
  };
  return {
    capabilities: () => call('capabilities', {}),
    checkSession: ({ signal } = {}) => call('session', {}, signal),
    startLogin: (platform, { signal } = {}) => call('login', { platform }, signal),
    uploadAsset: (pkg, asset, keyValue, { signal } = {}) => call('assets', { packageId: pkg.packageId, platform: pkg.platform, asset, idempotencyKey: `${keyValue}:${asset.assetId}` }, signal),
    createDraft: (pkg, keyValue, context = {}) => call('drafts', { package: pkg, idempotencyKey: keyValue, checkpoint: context.checkpoint }, context.signal),
    publish: (pkg, keyValue, context = {}) => call('publish', { package: pkg, idempotencyKey: keyValue, checkpoint: context.checkpoint }, context.signal),
    verify: (result, pkg, { signal } = {}) => call('verify', { result, package: pkg }, signal),
  };
}

function defaultAdapter() {
  if (process.env.NARRAFORM_DELIVERY_MODE === 'sandbox' || process.env.NODE_ENV === 'test') return createSandboxDraftAdapter();
  return webhookAdapter();
}

export async function getPlatformSession(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw deliveryError('PLATFORM_UNSUPPORTED', '当前只支持小红书、知乎和微信公众号');
  const adapter = defaultAdapter();
  if (!adapter) return { platform, status: 'connector_required', message: '尚未配置平台连接器，可先导出内容包' };
  return { platform, ...(await adapter.checkSession()) };
}

export async function startPlatformLogin(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) throw deliveryError('PLATFORM_UNSUPPORTED', '当前只支持小红书、知乎和微信公众号');
  const adapter = defaultAdapter();
  if (!adapter) throw deliveryError('DELIVERY_CONNECTOR_REQUIRED', '尚未配置平台连接器，可先导出内容包', 503);
  if (typeof adapter.startLogin !== 'function') throw deliveryError('DELIVERY_LOGIN_UNSUPPORTED', '当前连接器不支持任务内登录', 409);
  return { platform, ...(await adapter.startLogin(platform)) };
}

function aggregateJobStatus(items) {
  if (items.some((item) => ['uploading', 'submitting', 'verifying'].includes(item.status))) return 'running';
  if (items.some((item) => item.status === 'waiting_session')) return 'waiting_session';
  if (items.every((item) => item.status === 'delivered')) return 'delivered';
  if (items.some((item) => item.status === 'uncertain')) return 'uncertain';
  if (items.every((item) => item.status === 'preflight_failed' || item.status === 'failed')) return 'failed';
  return 'partial';
}

export async function createDeliveryJob(packageIds, { adapterResolver = defaultAdapter } = {}) {
  if (!Array.isArray(packageIds) || !packageIds.length) throw deliveryError('PUBLISH_PACKAGE_REQUIRED', '请选择至少一个发布包');
  const job = { jobId: `job_${crypto.randomUUID()}`, status: 'queued', items: [], events: [{ type: 'delivery.queued', at: now() }], createdAt: now(), updatedAt: now() };
  for (const packageId of [...new Set(packageIds)]) {
    const pkg = await getPublishPackage(packageId);
    if (!pkg) throw deliveryError('PUBLISH_PACKAGE_NOT_FOUND', '没有找到发布包', 404);
    const item = { packageId, platform: pkg.platform, status: 'queued', preflight: null, attempts: 0, receiptId: null, checkpoint: { uploadedAssets: {} } };
    job.items.push(item);
  }
  await putEntity('deliveryJobs', job, 'jobId');
  setImmediate(() => { void enqueueDeliveryJob(job.jobId, { adapterResolver }); });
  return job;
}

async function assertDeliveryActive(jobId, signal) {
  const latest = await getEntity('deliveryJobs', jobId, 'jobId');
  if (signal?.aborted || latest?.status === 'cancelled') throw deliveryError('DELIVERY_CANCELLED', '发布任务已取消', 499);
  return latest;
}

async function deliverItem(job, item, adapterResolver, signal) {
  const pkg = await getPublishPackage(item.packageId);
  if (!pkg) { item.status = 'failed'; item.errorCode = 'PUBLISH_PACKAGE_NOT_FOUND'; return item; }
  const adapter = typeof adapterResolver === 'function' ? await adapterResolver(pkg.platform) : adapterResolver;
  let capabilities;
  try {
    capabilities = adapter
      ? await runAdapterOperation({ adapterKey: `delivery:${pkg.platform}`, action: 'capabilities', execute: () => adapter.capabilities({ signal }) })
      : { draft: false, directPublish: false, verifyDraft: false, requiresSession: true };
  } catch (error) {
    if (error.code === 'DELIVERY_CANCELLED' || error.name === 'AbortError') {
      item.status = 'cancelled'; item.errorCode = 'DELIVERY_CANCELLED'; item.userMessage = '发布任务已取消';
      job.events.push({ type: 'delivery.cancelled', platform: pkg.platform, at: now() });
      return item;
    }
    item.status = 'failed'; item.errorCode = error.code || 'ADAPTER_CAPABILITIES_FAILED'; item.userMessage = '平台连接器暂时不可用，可以导出内容包或稍后重试。';
    job.events.push({ type: 'delivery.failed', platform: pkg.platform, code: item.errorCode, at: now() });
    return item;
  }
  item.preflight = await preflightPublishPackage(pkg, capabilities);
  if (item.preflight.status === 'blocked') { item.status = 'preflight_failed'; return item; }
  if (!adapter) {
    item.status = 'waiting_session';
    item.userMessage = '当前没有可用的平台连接器。可以先导出内容包，或配置发布连接器后继续。';
    job.events.push({ type: 'delivery.waiting_session', platform: pkg.platform, at: now() });
    return item;
  }
  if (pkg.target === 'draft' && !capabilities.draft) { item.status = 'failed'; item.errorCode = 'ADAPTER_DRAFT_UNSUPPORTED'; return item; }
  if (pkg.target === 'published' && (!capabilities.directPublish || typeof adapter.publish !== 'function')) {
    item.status = 'failed'; item.errorCode = 'ADAPTER_DIRECT_PUBLISH_UNSUPPORTED'; return item;
  }
  const adapterVersion = capabilities.adapterVersion || 'external-unknown';
  item.adapterVersion = adapterVersion;
  let session;
  try {
    await assertDeliveryActive(job.jobId, signal);
    session = await runAdapterOperation({ adapterKey: `delivery:${pkg.platform}`, action: 'check_session', adapterVersion, execute: () => adapter.checkSession({ signal }) });
  } catch (error) {
    if (error.code === 'DELIVERY_CANCELLED' || error.name === 'AbortError') {
      item.status = 'cancelled'; item.errorCode = 'DELIVERY_CANCELLED'; item.userMessage = '发布任务已取消';
      job.events.push({ type: 'delivery.cancelled', platform: pkg.platform, at: now() });
      return item;
    }
    item.status = 'failed'; item.errorCode = error.code || 'ADAPTER_SESSION_FAILED'; item.userMessage = '暂时无法确认平台登录状态，可以稍后重试。';
    job.events.push({ type: 'delivery.failed', platform: pkg.platform, code: item.errorCode, at: now() });
    return item;
  }
  if (session.status !== 'ready') { item.status = 'waiting_session'; item.session = session; return item; }
  try {
    item.checkpoint ||= { uploadedAssets: {} };
    item.checkpoint.uploadedAssets ||= {};
    if (capabilities.resumableAssets && typeof adapter.uploadAsset === 'function' && pkg.assets.length) {
      item.status = 'uploading'; job.updatedAt = now();
      await putEntity('deliveryJobs', job, 'jobId');
      for (const asset of [...pkg.assets].sort((a, b) => a.order - b.order)) {
        if (item.checkpoint.uploadedAssets[asset.assetId]) continue;
        await assertDeliveryActive(job.jobId, signal);
        const uploaded = await runAdapterOperation({
          adapterKey: `delivery:${pkg.platform}`,
          action: 'upload_asset',
          adapterVersion,
          operationId: `${job.jobId}:${asset.assetId}`,
          execute: () => adapter.uploadAsset(pkg, asset, idempotencyKey(pkg), { signal, checkpoint: item.checkpoint }),
        });
        item.checkpoint.uploadedAssets[asset.assetId] = uploaded;
        job.events.push({ type: 'delivery.asset_uploaded', platform: pkg.platform, assetId: asset.assetId, at: now() });
        job.updatedAt = now();
        await putEntity('deliveryJobs', job, 'jobId');
      }
    }
    await assertDeliveryActive(job.jobId, signal);
    item.attempts += 1; item.status = 'submitting'; job.events.push({ type: 'delivery.submitting', platform: pkg.platform, at: now() });
    job.updatedAt = now();
    await putEntity('deliveryJobs', job, 'jobId');
    const packageForAdapter = { ...pkg, assets: pkg.assets.map((asset) => ({ ...asset, remoteAsset: item.checkpoint.uploadedAssets[asset.assetId] || null })) };
    const submitted = await runAdapterOperation({
      adapterKey: `delivery:${pkg.platform}`,
      action: pkg.target === 'published' ? 'publish' : 'create_draft',
      adapterVersion,
      operationId: job.jobId,
      execute: () => pkg.target === 'published'
        ? adapter.publish(packageForAdapter, idempotencyKey(pkg), { signal, checkpoint: item.checkpoint })
        : adapter.createDraft(packageForAdapter, idempotencyKey(pkg), { signal, checkpoint: item.checkpoint }),
    });
    await assertDeliveryActive(job.jobId, signal);
    item.status = 'verifying';
    job.updatedAt = now();
    await putEntity('deliveryJobs', job, 'jobId');
    const verification = await runAdapterOperation({ adapterKey: `delivery:${pkg.platform}`, action: 'verify', adapterVersion, operationId: job.jobId, execute: () => adapter.verify(submitted, pkg, { signal }) });
    await assertDeliveryActive(job.jobId, signal);
    const receipt = {
      receiptId: `rcpt_${crypto.randomUUID()}`,
      jobId: job.jobId,
      packageId: pkg.packageId,
      contentId: pkg.contentId,
      contentRevision: pkg.contentRevision,
      platform: pkg.platform,
      target: pkg.target,
      status: verification.verified ? 'delivered' : 'uncertain',
      remoteDraftId: submitted.remoteDraftId || null,
      remoteUrl: submitted.remoteUrl || null,
      verified: Boolean(verification.verified),
      verificationMethod: verification.verificationMethod || null,
      submittedAt: now(),
      verifiedAt: verification.verified ? now() : null,
      adapterVersion: submitted.adapterVersion || adapterVersion,
    };
    await putEntity('deliveryReceipts', receipt, 'receiptId');
    item.receiptId = receipt.receiptId; item.status = receipt.status;
    job.events.push({ type: verification.verified ? 'delivery.delivered' : 'delivery.uncertain', platform: pkg.platform, receiptId: receipt.receiptId, at: now() });
  } catch (error) {
    if (error.code === 'DELIVERY_CANCELLED' || error.name === 'AbortError') {
      item.status = 'cancelled'; item.errorCode = 'DELIVERY_CANCELLED'; item.userMessage = '发布任务已取消';
      job.events.push({ type: 'delivery.cancelled', platform: pkg.platform, at: now() });
    } else {
      item.status = 'failed'; item.errorCode = error.code || 'DELIVERY_FAILED'; item.userMessage = error.message;
      job.events.push({ type: 'delivery.failed', platform: pkg.platform, code: item.errorCode, at: now() });
    }
  }
  return item;
}

export async function runDeliveryJob(jobId, { adapterResolver = defaultAdapter, signal } = {}) {
  let job = await getEntity('deliveryJobs', jobId, 'jobId');
  if (!job) throw deliveryError('DELIVERY_JOB_NOT_FOUND', '没有找到发布任务', 404);
  if (job.status === 'cancelled') return job;
  job.status = 'running'; job.updatedAt = now();
  job.events.push({ type: 'delivery.started', at: now() });
  for (const item of job.items) if (['uploading', 'submitting', 'verifying'].includes(item.status)) item.status = 'queued';
  await putEntity('deliveryJobs', job, 'jobId');
  for (const item of job.items) {
    const latest = await getEntity('deliveryJobs', jobId, 'jobId');
    if (!latest || latest.status === 'cancelled') return latest;
    job = latest;
    const current = job.items.find((entry) => entry.packageId === item.packageId);
    if (current && ['queued', 'ready', 'failed', 'waiting_session'].includes(current.status)) {
      await deliverItem(job, current, adapterResolver, signal);
      const persisted = await getEntity('deliveryJobs', jobId, 'jobId');
      if (!persisted || persisted.status === 'cancelled') return persisted;
      job.updatedAt = now();
      await putEntity('deliveryJobs', job, 'jobId');
    }
  }
  job.status = aggregateJobStatus(job.items); job.updatedAt = now();
  job.events.push({ type: 'delivery.completed', status: job.status, at: now() });
  await putEntity('deliveryJobs', job, 'jobId');
  return job;
}

export function enqueueDeliveryJob(jobId, options = {}) {
  if (deliveryRuns.has(jobId)) return deliveryRuns.get(jobId);
  const controller = new AbortController();
  deliveryControllers.set(jobId, controller);
  const run = runDeliveryJob(jobId, { ...options, signal: options.signal || controller.signal }).finally(() => {
    deliveryRuns.delete(jobId);
    deliveryControllers.delete(jobId);
  });
  deliveryRuns.set(jobId, run);
  return run;
}

export async function waitForDeliveryJob(jobId, options = {}) {
  const job = await getDeliveryJob(jobId);
  if (!job) throw deliveryError('DELIVERY_JOB_NOT_FOUND', '没有找到发布任务', 404);
  if (['delivered', 'partial', 'failed', 'waiting_session', 'uncertain', 'cancelled'].includes(job.status)) return job;
  return enqueueDeliveryJob(jobId, options);
}

export async function retryDeliveryJob(jobId, options = {}) {
  const job = await getEntity('deliveryJobs', jobId, 'jobId');
  if (!job) throw deliveryError('DELIVERY_JOB_NOT_FOUND', '没有找到发布任务', 404);
  for (const item of job.items) if (['failed', 'waiting_session'].includes(item.status)) item.status = 'queued';
  job.status = 'queued'; job.updatedAt = now(); job.events.push({ type: 'delivery.requeued', at: now() });
  await putEntity('deliveryJobs', job, 'jobId');
  setImmediate(() => { void enqueueDeliveryJob(jobId, options); });
  return job;
}

export async function cancelDeliveryJob(jobId) {
  deliveryControllers.get(jobId)?.abort();
  const job = await updateEntity('deliveryJobs', jobId, (current) => ({ ...current, status: 'cancelled', updatedAt: now(), events: [...current.events, { type: 'delivery.cancelled', at: now() }], items: current.items.map((item) => ['delivered', 'uncertain', 'failed', 'preflight_failed'].includes(item.status) ? item : { ...item, status: 'cancelled' }) }), 'jobId');
  if (!job) throw deliveryError('DELIVERY_JOB_NOT_FOUND', '没有找到发布任务', 404);
  return job;
}

export async function listDeliveryJobs() {
  return (await listEntities('deliveryJobs')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function resumePendingDeliveryJobs() {
  const jobs = (await listEntities('deliveryJobs')).filter((job) => ['queued', 'created', 'running'].includes(job.status));
  for (const job of jobs) setImmediate(() => { void enqueueDeliveryJob(job.jobId); });
  return jobs.length;
}

export async function getDeliveryJob(jobId) { return getEntity('deliveryJobs', jobId, 'jobId'); }
export async function getDeliveryReceipt(receiptId) { return getEntity('deliveryReceipts', receiptId, 'receiptId'); }
export async function listDeliveryReceipts() { return listEntities('deliveryReceipts'); }

export async function deleteDeliveryReceipt(receiptId) {
  return Boolean(await deleteEntity('deliveryReceipts', receiptId, 'receiptId'));
}

export async function deleteDeliveryForContent(contentId) {
  const packages = (await listEntities('publishPackages')).filter((item) => item.contentId === contentId);
  const packageIds = new Set(packages.map((item) => item.packageId));
  const jobs = (await listEntities('deliveryJobs')).filter((job) => job.items.some((item) => packageIds.has(item.packageId)));
  const receipts = (await listEntities('deliveryReceipts')).filter((item) => item.contentId === contentId || packageIds.has(item.packageId));
  await Promise.all([
    ...packages.map((item) => deleteEntity('publishPackages', item.packageId, 'packageId')),
    ...jobs.map((item) => deleteEntity('deliveryJobs', item.jobId, 'jobId')),
    ...receipts.map((item) => deleteEntity('deliveryReceipts', item.receiptId, 'receiptId')),
  ]);
  return { publishPackages: packages.length, deliveryJobs: jobs.length, deliveryReceipts: receipts.length };
}
