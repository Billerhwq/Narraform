import express from 'express';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { detectCodexCli } from './codex-cli.js';
import { buildFactSet, generateCopy, modifyCopy } from './content-engine.js';
import { createTaskBrief, publicTaskBrief } from './task-understanding.js';
import { createTextMaterial, fetchWebMaterial, parseUploadedFile, publicMaterial } from './materials.js';
import { getPublicSpecs, normalizePlatform, resolvePlatformSpec } from './platform-specs.js';
import { normalizeAndRepairResult, runQualityChecks } from './quality.js';
import { deleteContent, getContent, getContentVersions, getMaterials, getTask, listContents, renameContent, resetStore, restoreContentVersion, saveContent, saveMaterial, saveTask, selectTaskStrategy } from './store.js';
import { executeContentOperation } from './operation-engine.js';
import { getPublicOperationSpecs } from './operation-specs.js';
import { hashContent } from './change-set.js';
import { applyLearningRules } from './strategy-engine.js';
import { getPublicXhsFormatting, normalizeXhsFormattingOverride, resolveXhsFormattingProfile } from './xhs-formatting.js';
import { createMaterialSet, deleteMaterialItem, deleteMaterialSet, factSetFromMaterialSet, getMaterialAnalysisEvents, getMaterialAnalysisJob, getMaterialAsset, getMaterialSet, getMaterialSetInternal, queueMaterialSetItems, resolveMaterialConflicts, resumePendingMaterialAnalysisJobs, retryMaterialItem, updateMaterialFact } from './material-understanding.js';
import { resetRoadmapStore } from './roadmap-store.js';
import { cancelDeliveryJob, createDeliveryJob, createPublishPackages, deleteDeliveryForContent, deleteDeliveryReceipt, getDeliveryJob, getDeliveryReceipt, getPlatformSession, getPublishPackage, listDeliveryJobs, listDeliveryReceipts, listPublishPackages, preflightPublishPackage, resumePendingDeliveryJobs, retryDeliveryJob, startPlatformLogin } from './publish-delivery.js';
import { approveInsight, createPerformanceSnapshot, deletePerformanceByReceipt, deletePerformanceForContent, deletePerformanceSnapshot, dismissInsight, generateRetrospective, getRetrospectiveState, getStrategyContext, listContentPerformance, listLearningRules, syncPerformanceSnapshot, updateLearningRule } from './performance-learning.js';
import { listRuntimeEvents } from './adapter-runtime.js';

const app = express();
const port = Number(process.env.CONTENTFLOW_API_PORT || 4176);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 20 } });

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', async (_request, response, next) => {
  try {
    const codex = await detectCodexCli();
    response.json({
      ok: true,
      modelConfigured: Boolean(process.env.DEEPSEEK_API_KEY) || (codex.enabled && codex.detected),
      modelMode: process.env.CONTENTFLOW_MODEL_MODE || 'deepseek',
      codex,
      deepSeekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    });
  } catch (error) { next(error); }
});

app.get('/api/specs', (_request, response) => response.json({ specs: getPublicSpecs(), operationSpecs: getPublicOperationSpecs() }));

app.get('/api/runtime-events', async (request, response, next) => {
  try { response.json({ events: await listRuntimeEvents(request.query) }); } catch (error) { next(error); }
});

app.post('/api/materials/upload', upload.array('files', 10), async (request, response, next) => {
  try {
    const parsed = await Promise.all((request.files || []).map(parseUploadedFile));
    const stored = await Promise.all(parsed.map(saveMaterial));
    response.status(201).json({ materials: stored.map(publicMaterial) });
  } catch (error) { next(error); }
});

app.post('/api/materials/text', async (request, response, next) => {
  try {
    const stored = await saveMaterial(createTextMaterial(request.body.text, request.body.name));
    response.status(201).json({ material: publicMaterial(stored) });
  } catch (error) { next(error); }
});

app.post('/api/materials/url', async (request, response, next) => {
  try {
    const stored = await saveMaterial(await fetchWebMaterial(request.body.url));
    response.status(201).json({ material: publicMaterial(stored) });
  } catch (error) { next(error); }
});

app.post('/api/material-sets', async (request, response, next) => {
  try { response.status(201).json({ materialSet: await createMaterialSet({ instruction: request.body.instruction || '' }) }); }
  catch (error) { next(error); }
});

app.post('/api/material-sets/:id/items', upload.array('files', 20), async (request, response, next) => {
  try {
    let items = request.body.items || [];
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch { items = []; }
    }
    if (!Array.isArray(items)) items = [items];
    response.status(202).json(await queueMaterialSetItems(request.params.id, { files: request.files || [], items }));
  } catch (error) { next(error); }
});

app.get('/api/material-analysis-jobs/:id', async (request, response, next) => {
  try {
    const job = await getMaterialAnalysisJob(request.params.id);
    if (!job) return response.status(404).json({ code: 'MATERIAL_ANALYSIS_JOB_NOT_FOUND', error: '没有找到素材分析任务' });
    response.json({ job });
  } catch (error) { next(error); }
});

app.get('/api/material-analysis-jobs/:id/events', async (request, response, next) => {
  try { response.json(await getMaterialAnalysisEvents(request.params.id, request.query.after)); }
  catch (error) { next(error); }
});

app.post('/api/material-sets/:id/items/:sourceId/retry', async (request, response, next) => {
  try { response.status(202).json(await retryMaterialItem(request.params.id, request.params.sourceId)); }
  catch (error) { next(error); }
});

app.delete('/api/material-sets/:id/items/:sourceId', async (request, response, next) => {
  try { response.json({ materialSet: await deleteMaterialItem(request.params.id, request.params.sourceId) }); }
  catch (error) { next(error); }
});

app.get('/api/material-sets/:id/analysis', async (request, response, next) => {
  try {
    const materialSet = await getMaterialSet(request.params.id);
    if (!materialSet) return response.status(404).json({ code: 'MATERIAL_SET_NOT_FOUND', error: '没有找到这组创作资料' });
    response.json({ materialSetId: materialSet.materialSetId, revision: materialSet.revision, ...materialSet.analysis });
  } catch (error) { next(error); }
});

app.get('/api/material-sets/:id/items/:sourceId/asset', async (request, response, next) => {
  try {
    const asset = await getMaterialAsset(request.params.id, request.params.sourceId);
    if (!asset) return response.status(404).json({ code: 'MATERIAL_ASSET_NOT_FOUND', error: '没有找到这份图片资料' });
    response.type(asset.mimeType).set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`).send(asset.buffer);
  } catch (error) { next(error); }
});

app.get('/api/material-sets/:id', async (request, response, next) => {
  try {
    const materialSet = await getMaterialSet(request.params.id);
    if (!materialSet) return response.status(404).json({ code: 'MATERIAL_SET_NOT_FOUND', error: '没有找到这组创作资料' });
    response.json({ materialSet });
  } catch (error) { next(error); }
});

app.patch('/api/material-sets/:id/facts/:factId', async (request, response, next) => {
  try {
    const materialSet = await updateMaterialFact(request.params.id, request.params.factId, request.body, request.body.baseRevision ?? request.get('If-Match'));
    if (!materialSet) return response.status(404).json({ code: 'MATERIAL_SET_NOT_FOUND', error: '没有找到这组创作资料' });
    response.json({ materialSet });
  } catch (error) { next(error); }
});

app.post('/api/material-sets/:id/resolve-conflicts', async (request, response, next) => {
  try {
    const materialSet = await resolveMaterialConflicts(request.params.id, request.body.resolutions || [], request.body.baseRevision ?? request.get('If-Match'));
    if (!materialSet) return response.status(404).json({ code: 'MATERIAL_SET_NOT_FOUND', error: '没有找到这组创作资料' });
    response.json({ materialSet });
  } catch (error) { next(error); }
});

app.delete('/api/material-sets/:id', async (request, response, next) => {
  try {
    if (!(await deleteMaterialSet(request.params.id))) return response.status(404).json({ code: 'MATERIAL_SET_NOT_FOUND', error: '没有找到这组创作资料' });
    response.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/tasks/understand', async (request, response, next) => {
  try {
    const materials = await getMaterials(request.body.materialIds || []);
    const materialSet = request.body.materialSetId ? await getMaterialSetInternal(request.body.materialSetId) : null;
    if (request.body.materialSetId && !materialSet) return response.status(404).json({ code: 'MATERIAL_SET_NOT_FOUND', error: '没有找到这组创作资料' });
    const { taskBrief, factSet } = createTaskBrief({
      instruction: request.body.instruction || '',
      platform: normalizePlatform(request.body.platform),
      platformMode: request.body.platformMode,
      tone: request.body.tone,
      materials,
      factSet: materialSet ? factSetFromMaterialSet(materialSet) : null,
    });
    if (materialSet) taskBrief.materialSetId = materialSet.materialSetId;
    const learningRules = await getStrategyContext({ platform: taskBrief.platform, contentType: taskBrief.contentType });
    const taskWithLearning = applyLearningRules(taskBrief, learningRules, request.body.excludedLearningRuleIds || []);
    await saveTask(taskWithLearning);
    response.status(201).json({
      status: taskWithLearning.status,
      taskBrief: publicTaskBrief(taskWithLearning),
      questions: taskWithLearning.questions,
      factCount: factSet.verifiedFacts.length,
    });
  } catch (error) { next(error); }
});

app.post('/api/tasks/:taskId/select-strategy', async (request, response, next) => {
  try {
    const taskBrief = await selectTaskStrategy(request.params.taskId, request.body.strategyId);
    if (!taskBrief) return response.status(404).json({ error: '没有找到对应任务或策略' });
    response.json({ status: taskBrief.status, taskBrief: publicTaskBrief(taskBrief) });
  } catch (error) { next(error); }
});

app.post('/api/tasks/:taskId/learning-rules/:ruleId', async (request, response, next) => {
  try {
    const taskBrief = await getTask(request.params.taskId);
    if (!taskBrief) return response.status(404).json({ code: 'TASK_NOT_FOUND', error: '没有找到对应创作任务' });
    const availableRules = await getStrategyContext({ platform: taskBrief.platform, contentType: taskBrief.contentType });
    if (!availableRules.some((rule) => rule.ruleId === request.params.ruleId)) {
      return response.status(404).json({ code: 'LEARNING_RULE_NOT_FOUND', error: '这条创作经验已失效或不适用于当前任务' });
    }
    const excluded = new Set(taskBrief.excludedLearningRuleIds || []);
    if (request.body.enabled === false) excluded.add(request.params.ruleId); else excluded.delete(request.params.ruleId);
    const updated = applyLearningRules(taskBrief, availableRules, [...excluded]);
    updated.selectedStrategyId = null;
    updated.status = updated.questions?.length ? 'needs_input' : 'awaiting_strategy';
    await saveTask(updated);
    response.json({ status: updated.status, taskBrief: publicTaskBrief(updated) });
  } catch (error) { next(error); }
});

async function operationContext(body, operation) {
  const taskBrief = body.taskId ? await getTask(body.taskId) : null;
  if (body.taskId && !taskBrief && operation === 'generate') {
    const error = new Error('创作任务已失效，请重新分析');
    error.code = 'TASK_NOT_FOUND'; error.status = 404; throw error;
  }
  const materials = await getMaterials(body.materialIds || taskBrief?.sourceIds || []);
  const currentBody = body.currentResult?.bodyMarkdown || body.currentCopy || '';
  const fallbackInstruction = [
    body.baseInstruction || body.instruction || body.modification || '',
    currentBody ? `当前正文：\n${currentBody}` : '',
  ].filter(Boolean).join('\n\n');
  const factSet = taskBrief ? null : buildFactSet({ instruction: fallbackInstruction, materials });
  return { taskBrief, materials, factSet };
}

function operationRequest(body, operation) {
  const currentResult = body.currentResult || (body.currentCopy !== undefined ? {
    resultId: body.parentResultId || body.resultId || null,
    platform: body.platform,
    platformMode: body.platformMode,
    titleCandidates: body.titleCandidates || [],
    selectedTitleIndex: body.selectedTitleIndex || 0,
    summary: body.summary ?? null,
    bodyMarkdown: body.currentCopy || '',
    topics: body.topics || [],
    commentPrompt: body.commentPrompt || null,
    formatting: body.formatting || null,
    formattingOverride: body.formattingOverride || null,
    removedTopics: body.removedTopics || [],
    strategySnapshot: body.strategy,
    taskId: body.taskId,
    strategyId: body.strategyId,
  } : null);
  return {
    ...body,
    operation,
    currentResult,
    baseInstruction: body.baseInstruction || body.instruction,
    parentResultId: body.parentResultId || currentResult?.resultId || undefined,
    bodyHash: body.bodyHash || (currentResult ? hashContent(currentResult.bodyMarkdown) : undefined),
  };
}

async function executeFromHttp(body, signal, forcedOperation) {
  const operation = forcedOperation || body.operation;
  const context = await operationContext(body, operation);
  return executeContentOperation(operationRequest(body, operation), { ...context, signal });
}

app.post('/api/content-operations', async (request, response, next) => {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  try { response.json(await executeFromHttp(request.body, controller.signal)); } catch (error) { next(error); }
});

function writeSse(response, event, payload) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  response.flush?.();
}

app.post('/api/content-operations/stream', async (request, response) => {
  const controller = new AbortController();
  const operationId = request.body.operationId || request.get('Idempotency-Key') || crypto.randomUUID();
  request.once('aborted', () => controller.abort());
  response.once('close', () => { if (!response.writableEnded) controller.abort(); });
  response.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  response.socket?.setNoDelay(true);
  const started = { operation: request.body.operation, operationId, attempt: 1 };
  writeSse(response, 'started', started);
  writeSse(response, 'operation.started', started);
  try {
    const output = await executeFromHttp({ ...request.body, operationId }, controller.signal);
    const field = output.changeSet.changedFields.includes('bodyMarkdown') ? 'bodyMarkdown'
      : output.changeSet.changedFields.includes('titleCandidates') ? 'titleCandidates' : output.changeSet.changedFields[0];
    const value = field === 'titleCandidates' ? JSON.stringify(output.result.titleCandidates) : String(output.result[field] ?? '');
    writeSse(response, 'field.reset', { operationId: output.operationId, field });
    let index = 0;
    for (const character of value) {
      if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { code: 'ABORTED', status: 499 });
      const delta = { operationId: output.operationId, field, delta: character, text: character, index };
      writeSse(response, 'field.delta', delta);
      writeSse(response, 'delta', delta);
      index += 1;
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { code: 'ABORTED', status: 499 });
    const verification = { operationId: output.operationId, checks: ['field_permissions', 'facts', 'platform', 'operation_quality'] };
    writeSse(response, 'verifying', verification);
    writeSse(response, 'quality.completed', { operationId: output.operationId, qualityReport: output.result.qualityReport });
    if (request.body.contentId) {
      if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { code: 'ABORTED', status: 499 });
      const selectedTitle = output.result.titleCandidates?.[output.result.selectedTitleIndex || 0];
      const saved = await saveContent({
        id: request.body.contentId,
        baseRevision: request.body.baseRevision,
        name: selectedTitle || '未命名文案',
        platform: output.result.platform || request.body.platform,
        materialIds: request.body.materialIds || [],
        materialSetId: request.body.materialSetId || null,
        ...output.result,
        reason: request.body.operation,
      });
      output.savedContent = { id: saved.id, revision: saved.revision, updatedAt: saved.updatedAt };
      writeSse(response, 'version.saved', { operationId: output.operationId, contentId: saved.id, revision: saved.revision, updatedAt: saved.updatedAt });
    }
    writeSse(response, 'completed', output);
    writeSse(response, 'operation.completed', output);
    response.end();
  } catch (error) {
    if (!response.writableEnded) {
      const failure = { code: error.code || 'OPERATION_FAILED', error: publicError(error), operationId };
      writeSse(response, 'error', failure);
      writeSse(response, 'operation.failed', failure);
      response.end();
    }
  }
});

app.post('/api/generate', async (request, response, next) => {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  try { response.json(await executeFromHttp(request.body, controller.signal, 'generate')); } catch (error) { next(error); }
});

app.post('/api/modify', async (request, response, next) => {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort());
  const actionMap = { modify_titles: 'regenerate_titles', modify_body: 'regenerate_body', polish: 'polish' };
  try { response.json(await executeFromHttp(request.body, controller.signal, actionMap[request.body.action] || 'custom_modify')); } catch (error) { next(error); }
});

app.post('/api/quality', async (request, response, next) => {
  try {
    const taskBrief = request.body.taskId ? await getTask(request.body.taskId) : null;
    const platform = normalizePlatform(request.body.platform || taskBrief?.platform);
    const materials = await getMaterials(request.body.materialIds || taskBrief?.sourceIds || []);
    const factSet = taskBrief ? { verifiedFacts: taskBrief.facts || [], experiences: taskBrief.experiences || [], conflicts: [], knownNumbers: [] } : buildFactSet({ instruction: request.body.instruction || '', materials });
    const input = request.body.result || {};
    const spec = resolvePlatformSpec(platform, input.platformMode || taskBrief?.platformMode, request.body.instruction || taskBrief?.instruction || '');
    const formattingProfile = platform === 'xiaohongshu'
      ? resolveXhsFormattingProfile({ taskBrief: taskBrief || { contentType: input.strategySnapshot?.contentType || 'general_article', facts: factSet.verifiedFacts || [] }, strategy: input.strategySnapshot || {}, userOverride: input.formattingOverride || {} })
      : null;
    const result = normalizeAndRepairResult({ ...input, platform }, spec, { taskBrief, factSet, formattingProfile, removedTopics: input.removedTopics || [] });
    result.formatting = platform === 'xiaohongshu' ? getPublicXhsFormatting(formattingProfile) : null;
    result.platformSpecVersion = spec.version;
    result.qualityReport = runQualityChecks(result, spec, factSet, { taskBrief, strategy: input.strategySnapshot || {}, formattingProfile });
    response.json({ result });
  } catch (error) { next(error); }
});

app.get('/api/contents', async (_request, response, next) => {
  try { response.json({ contents: await listContents() }); } catch (error) { next(error); }
});
app.get('/api/contents/:id', async (request, response, next) => {
  try {
    const content = await getContent(request.params.id);
    if (!content) return response.status(404).json({ error: '没有找到这条内容记录' });
    const materials = await getMaterials(content.materialIds || []);
    response.json({ content, materials: materials.map(publicMaterial) });
  } catch (error) { next(error); }
});
app.post('/api/contents', async (request, response, next) => {
  try {
    let payload = request.body;
    if (normalizePlatform(payload.platform) === 'xiaohongshu') {
      const taskBrief = payload.taskId ? await getTask(payload.taskId) : null;
      const formattingOverride = normalizeXhsFormattingOverride(payload.formattingOverride || {});
      const formattingProfile = resolveXhsFormattingProfile({
        taskBrief: taskBrief || { contentType: payload.strategySnapshot?.contentType || 'general_article', facts: [] },
        strategy: payload.strategySnapshot || {},
        userOverride: formattingOverride,
      });
      payload = { ...payload, formatting: getPublicXhsFormatting(formattingProfile), formattingProfile, formattingOverride };
    }
    response.status(201).json({ content: await saveContent(payload) });
  } catch (error) { next(error); }
});
app.get('/api/contents/:id/versions', async (request, response, next) => {
  try {
    const versions = await getContentVersions(request.params.id);
    if (!versions) return response.status(404).json({ code: 'CONTENT_NOT_FOUND', error: '没有找到这条内容记录' });
    response.json({ contentId: request.params.id, versions });
  } catch (error) { next(error); }
});
app.post('/api/contents/:id/versions/:versionId/restore', async (request, response, next) => {
  try {
    const baseRevision = request.body.baseRevision ?? request.get('If-Match');
    const content = await restoreContentVersion(request.params.id, request.params.versionId, baseRevision);
    if (!content) return response.status(404).json({ code: 'CONTENT_NOT_FOUND', error: '没有找到这条内容记录' });
    response.json({ content, version: content.versions.at(-1) });
  } catch (error) { next(error); }
});
app.patch('/api/contents/:id', async (request, response, next) => {
  try {
    if (request.body.bodyMarkdown !== undefined || request.body.titleCandidates !== undefined) {
      const baseRevision = request.body.baseRevision ?? request.get('If-Match');
      const content = await saveContent({ ...request.body, id: request.params.id, baseRevision });
      return response.json({ content, version: content.versions.at(-1) });
    }
    const content = await renameContent(request.params.id, request.body.name || '');
    if (!content) return response.status(404).json({ error: '没有找到这条内容记录' });
    response.json({ content });
  } catch (error) { next(error); }
});
app.delete('/api/contents/:id', async (request, response, next) => {
  try {
    if (!(await deleteContent(request.params.id))) return response.status(404).json({ error: '没有找到这条内容记录' });
    await Promise.all([deletePerformanceForContent(request.params.id), deleteDeliveryForContent(request.params.id)]);
    response.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/publish-packages', async (_request, response, next) => {
  try { response.json({ packages: await listPublishPackages() }); } catch (error) { next(error); }
});
app.post('/api/publish-packages', async (request, response, next) => {
  try { response.status(201).json({ packages: await createPublishPackages(request.body) }); } catch (error) { next(error); }
});
app.get('/api/publish-packages/:id', async (request, response, next) => {
  try {
    const publishPackage = await getPublishPackage(request.params.id);
    if (!publishPackage) return response.status(404).json({ code: 'PUBLISH_PACKAGE_NOT_FOUND', error: '没有找到发布包' });
    response.json({ package: publishPackage });
  } catch (error) { next(error); }
});
app.post('/api/publish-packages/:id/preflight', async (request, response, next) => {
  try { response.json({ preflight: await preflightPublishPackage(request.params.id) }); } catch (error) { next(error); }
});
app.get('/api/delivery-jobs', async (_request, response, next) => {
  try { response.json({ jobs: await listDeliveryJobs() }); } catch (error) { next(error); }
});
app.post('/api/delivery-jobs', async (request, response, next) => {
  try { response.status(202).json({ job: await createDeliveryJob(request.body.packageIds || []) }); } catch (error) { next(error); }
});
app.get('/api/delivery-jobs/:id', async (request, response, next) => {
  try {
    const job = await getDeliveryJob(request.params.id);
    if (!job) return response.status(404).json({ code: 'DELIVERY_JOB_NOT_FOUND', error: '没有找到发布任务' });
    response.json({ job });
  } catch (error) { next(error); }
});
app.get('/api/delivery-jobs/:id/events', async (request, response, next) => {
  try {
    const job = await getDeliveryJob(request.params.id);
    if (!job) return response.status(404).json({ code: 'DELIVERY_JOB_NOT_FOUND', error: '没有找到发布任务' });
    const after = Math.max(0, Number(request.query.after) || 0);
    response.json({ jobId: job.jobId, status: job.status, events: job.events.slice(after), nextCursor: job.events.length });
  } catch (error) { next(error); }
});
app.post('/api/delivery-jobs/:id/retry', async (request, response, next) => {
  try { response.status(202).json({ job: await retryDeliveryJob(request.params.id) }); } catch (error) { next(error); }
});
app.post('/api/delivery-jobs/:id/cancel', async (request, response, next) => {
  try { response.json({ job: await cancelDeliveryJob(request.params.id) }); } catch (error) { next(error); }
});
app.get('/api/platform-sessions/:platform', async (request, response, next) => {
  try { response.json({ session: await getPlatformSession(request.params.platform) }); }
  catch (error) { next(error); }
});
app.post('/api/platform-sessions/:platform/login', async (request, response, next) => {
  try { response.status(202).json({ session: await startPlatformLogin(request.params.platform) }); }
  catch (error) { next(error); }
});
app.get('/api/delivery-receipts', async (_request, response, next) => {
  try { response.json({ receipts: await listDeliveryReceipts() }); } catch (error) { next(error); }
});
app.get('/api/delivery-receipts/:id', async (request, response, next) => {
  try {
    const receipt = await getDeliveryReceipt(request.params.id);
    if (!receipt) return response.status(404).json({ code: 'DELIVERY_RECEIPT_NOT_FOUND', error: '没有找到送达回执' });
    response.json({ receipt });
  } catch (error) { next(error); }
});
app.delete('/api/delivery-receipts/:id', async (request, response, next) => {
  try {
    const receipt = await getDeliveryReceipt(request.params.id);
    if (!receipt) return response.status(404).json({ code: 'DELIVERY_RECEIPT_NOT_FOUND', error: '没有找到送达回执' });
    await deletePerformanceByReceipt(request.params.id);
    await deleteDeliveryReceipt(request.params.id);
    response.status(204).end();
  } catch (error) { next(error); }
});

app.post('/api/performance-snapshots', async (request, response, next) => {
  try { response.status(201).json({ snapshot: await createPerformanceSnapshot(request.body) }); } catch (error) { next(error); }
});
app.post('/api/performance-snapshots/import', async (request, response, next) => {
  try { response.status(201).json({ snapshot: await createPerformanceSnapshot(request.body) }); } catch (error) { next(error); }
});
app.post('/api/performance-snapshots/sync', async (request, response, next) => {
  try { response.status(201).json({ snapshot: await syncPerformanceSnapshot(request.body) }); } catch (error) { next(error); }
});
app.get('/api/contents/:id/performance', async (request, response, next) => {
  try { response.json({ snapshots: await listContentPerformance(request.params.id) }); } catch (error) { next(error); }
});
app.delete('/api/performance-snapshots/:id', async (request, response, next) => {
  try {
    if (!(await deletePerformanceSnapshot(request.params.id))) return response.status(404).json({ code: 'PERFORMANCE_SNAPSHOT_NOT_FOUND', error: '没有找到表现快照' });
    response.status(204).end();
  } catch (error) { next(error); }
});
app.post('/api/contents/:id/retrospective', async (request, response, next) => {
  try { response.json(await generateRetrospective(request.params.id, request.body.snapshotId || null)); } catch (error) { next(error); }
});
app.get('/api/contents/:id/retrospective', async (request, response, next) => {
  try { response.json(await getRetrospectiveState(request.params.id)); } catch (error) { next(error); }
});
app.get('/api/learning-rules', async (_request, response, next) => {
  try { response.json({ rules: await listLearningRules() }); } catch (error) { next(error); }
});
app.post('/api/learning-rules/:id/approve', async (request, response, next) => {
  try { response.status(201).json({ rule: await approveInsight(request.params.id) }); } catch (error) { next(error); }
});
app.post('/api/learning-rules/:id/dismiss', async (request, response, next) => {
  try { response.json({ insight: await dismissInsight(request.params.id) }); } catch (error) { next(error); }
});
app.patch('/api/learning-rules/:id', async (request, response, next) => {
  try { response.json({ rule: await updateLearningRule(request.params.id, request.body) }); } catch (error) { next(error); }
});
app.get('/api/strategy-context', async (request, response, next) => {
  try { response.json({ rules: await getStrategyContext(request.query) }); } catch (error) { next(error); }
});

if (process.env.NODE_ENV === 'test') app.post('/api/test/reset', async (_request, response) => { await resetStore(); await resetRoadmapStore(); response.status(204).end(); });

function publicError(error) {
  const known = new Set(['TASK_NOT_FOUND', 'CONTENT_STALE', 'CONTENT_REVISION_CONFLICT', 'CONTENT_NOT_FOUND', 'VERSION_NOT_FOUND', 'INVALID_OPERATION', 'INVALID_SCOPE', 'ABORTED']);
  if (known.has(error.code)) return error.message;
  if (error.status && error.status < 500 && error.code !== 'NO_ACCEPTABLE_CHANGE') return error.message;
  if (error.code === 'NO_ACCEPTABLE_CHANGE') return '这次没有生成可用内容，原内容已保留';
  return '内容处理暂时没有完成，当前内容已保留，请稍后重试';
}

app.use((error, request, response, _next) => {
  const status = error instanceof multer.MulterError ? 400 : error.status || 500;
  const message = error instanceof multer.MulterError
    ? error.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 20 MB' : '文件上传失败，请减少文件数量或重试'
    : publicError(error);
  if (status >= 500 && process.env.NODE_ENV !== 'test') {
    console.error('[Narraform API]', {
      method: request.method,
      path: request.path,
      status,
      code: error.code || 'OPERATION_FAILED',
      message: error.message,
      stack: error.stack,
    });
  }
  response.status(status).json({ code: error.code || 'OPERATION_FAILED', error: message });
});

if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  detectCodexCli().then((codex) => console.log(`Codex CLI ${codex.status}${codex.version ? ` (${codex.version})` : ''}`));
  app.listen(port, '127.0.0.1', async () => {
    const [materialsResumed, deliveriesResumed] = await Promise.all([
      resumePendingMaterialAnalysisJobs().catch((error) => { console.error('[Narraform material queue]', error); return 0; }),
      resumePendingDeliveryJobs().catch((error) => { console.error('[Narraform delivery queue]', error); return 0; }),
    ]);
    const resumed = materialsResumed + deliveriesResumed;
    console.log(`Narraform API http://127.0.0.1:${port}${resumed ? ` · resumed ${resumed} background job(s)` : ''}`);
  });
}

export default app;
