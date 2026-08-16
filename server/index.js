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
import { deleteContent, getContent, getMaterials, getTask, listContents, renameContent, resetStore, saveContent, saveMaterial, saveTask, selectTaskStrategy } from './store.js';
import { executeContentOperation } from './operation-engine.js';
import { getPublicOperationSpecs } from './operation-specs.js';
import { hashContent } from './change-set.js';
import { getPublicXhsFormatting, normalizeXhsFormattingOverride, resolveXhsFormattingProfile } from './xhs-formatting.js';

const app = express();
const port = Number(process.env.CONTENTFLOW_API_PORT || 4176);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 10 } });

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

app.post('/api/tasks/understand', async (request, response, next) => {
  try {
    const materials = await getMaterials(request.body.materialIds || []);
    const { taskBrief, factSet } = createTaskBrief({
      instruction: request.body.instruction || '',
      platform: normalizePlatform(request.body.platform),
      platformMode: request.body.platformMode,
      tone: request.body.tone,
      materials,
    });
    await saveTask(taskBrief);
    response.status(201).json({
      status: taskBrief.status,
      taskBrief: publicTaskBrief(taskBrief),
      questions: taskBrief.questions,
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
  const operationId = crypto.randomUUID();
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
  writeSse(response, 'started', { operation: request.body.operation, operationId });
  try {
    const output = await executeFromHttp({ ...request.body, operationId }, controller.signal);
    const field = output.changeSet.changedFields.includes('bodyMarkdown') ? 'bodyMarkdown'
      : output.changeSet.changedFields.includes('titleCandidates') ? 'titleCandidates' : output.changeSet.changedFields[0];
    const value = field === 'titleCandidates' ? JSON.stringify(output.result.titleCandidates) : String(output.result[field] ?? '');
    let index = 0;
    for (const character of value) {
      if (controller.signal.aborted) throw Object.assign(new Error('操作已取消'), { code: 'ABORTED', status: 499 });
      writeSse(response, 'delta', { operationId: output.operationId, field, delta: character, index });
      index += 1;
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    writeSse(response, 'verifying', { operationId: output.operationId, checks: ['field_permissions', 'facts', 'platform', 'operation_quality'] });
    writeSse(response, 'completed', output);
    response.end();
  } catch (error) {
    if (!response.writableEnded) {
      writeSse(response, 'error', { code: error.code || 'OPERATION_FAILED', error: publicError(error) });
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
app.patch('/api/contents/:id', async (request, response, next) => {
  try {
    const content = await renameContent(request.params.id, request.body.name || '');
    if (!content) return response.status(404).json({ error: '没有找到这条内容记录' });
    response.json({ content });
  } catch (error) { next(error); }
});
app.delete('/api/contents/:id', async (request, response, next) => {
  try {
    if (!(await deleteContent(request.params.id))) return response.status(404).json({ error: '没有找到这条内容记录' });
    response.status(204).end();
  } catch (error) { next(error); }
});

if (process.env.NODE_ENV === 'test') app.post('/api/test/reset', async (_request, response) => { await resetStore(); response.status(204).end(); });

function publicError(error) {
  const known = new Set(['TASK_NOT_FOUND', 'CONTENT_STALE', 'INVALID_OPERATION', 'INVALID_SCOPE', 'ABORTED']);
  if (known.has(error.code)) return error.message;
  if (error.status && error.status < 500 && error.code !== 'NO_ACCEPTABLE_CHANGE') return error.message;
  if (error.code === 'NO_ACCEPTABLE_CHANGE') return '这次没有生成可用内容，原内容已保留';
  return '内容处理暂时没有完成，当前内容已保留，请稍后重试';
}

app.use((error, request, response, _next) => {
  const status = error instanceof multer.MulterError ? 400 : error.status || 500;
  const message = error instanceof multer.MulterError
    ? error.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 15 MB' : '文件上传失败，请减少文件数量或重试'
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
  app.listen(port, '127.0.0.1', () => console.log(`Narraform API http://127.0.0.1:${port}`));
}

export default app;
