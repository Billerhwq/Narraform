import crypto from 'node:crypto';
import path from 'node:path';
import { imageSize } from 'image-size';
import { createTextMaterial, fetchWebMaterial, parseUploadedFile } from './materials.js';
import { deleteEntity, getEntity, listEntities, putEntity, readMaterialAsset, removeMaterialAsset, removeMaterialSetAssets, saveMaterialAsset, updateEntity } from './roadmap-store.js';
import { runAdapterOperation } from './adapter-runtime.js';

const MAX_ITEMS = 20;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const FACT_SENTENCE = /[^。！？!?\n]+[。！？!?]?/g;
const analysisRuns = new Map();

function now() { return new Date().toISOString(); }
function materialError(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; return error; }
function publicItem(item) { const { text, inputText, storagePath, segments, ...safe } = item; return { ...safe, excerpt: text?.slice(0, 160) || null }; }
function sourceLocator(item, statement, index) {
  const segment = item.segments?.find((entry) => entry.text.includes(statement));
  if (segment) {
    const start = segment.text.indexOf(statement);
    return { ...segment.locator, start, end: start + statement.length };
  }
  const start = Math.max(0, item.text.indexOf(statement));
  if (item.type === 'url') return { url: item.url, start, end: start + statement.length };
  return { start, end: start + statement.length, paragraph: index + 1 };
}

function normalizeStatement(value = '') {
  return value.replace(/^[-*\d.、\s]+/, '').replace(/\s+/g, ' ').trim();
}

function textEvidence(item) {
  const statements = (item.text.match(FACT_SENTENCE) || []).map(normalizeStatement).filter((value) => value.length >= 8 && value.length <= 500);
  return statements.slice(0, 80).map((statement, index) => ({
    factId: `fact_${crypto.randomUUID()}`,
    statement,
    evidenceClass: item.type === 'user_text' ? 'user_claim' : 'verified_fact',
    sourceType: item.type,
    sourceId: item.sourceId,
    locator: sourceLocator(item, statement, index),
    confidence: 1,
    usableForClaims: true,
    userStatus: item.type === 'user_text' ? 'confirmed' : 'unreviewed',
  }));
}

function imageDimensions(buffer, mimeType) {
  try {
    const dimensions = imageSize(buffer);
    return { width: dimensions.width ?? null, height: dimensions.height ?? null };
  } catch {
    // Preserve support for minimally encoded PNG fixtures while treating unreadable images as unknown.
    if (mimeType === 'image/png' && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  return { width: null, height: null };
}

async function defaultVisionClient({ buffer, mimeType, name }) {
  const endpoint = process.env.NARRAFORM_VISION_API_URL;
  const key = process.env.NARRAFORM_VISION_API_KEY;
  const model = process.env.NARRAFORM_VISION_MODEL;
  if (!endpoint || !key || !model) return { status: 'analysis_unavailable', observations: [], ocrText: '', unknowns: ['当前没有配置图片理解模型'] };
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: `读取这张产品截图（${name}）。只输出可见事实，返回 JSON：{"observations":[{"statement":"...","locator":{"x":0,"y":0,"width":1,"height":1},"confidence":0.9}],"ocrText":"...","unknowns":[]}` },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${buffer.toString('base64')}` } },
      ] }],
    }),
  });
  if (!response.ok) throw materialError('VISION_UNAVAILABLE', `图片理解服务返回 ${response.status}`, 503);
  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content || payload.output_text || '{}';
  const parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) : raw;
  return { status: 'ready', observations: parsed.observations || [], ocrText: parsed.ocrText || '', unknowns: parsed.unknowns || [] };
}

function detectConflicts(facts) {
  const values = new Map();
  for (const fact of facts) {
    const match = fact.statement.match(/^(.{2,24}?)(?:是|为|支持|包含)(.+)$/);
    if (!match) continue;
    const key = match[1].replace(/\s/g, '');
    const value = match[2].replace(/[。！？!?\s]/g, '');
    if (!values.has(key)) values.set(key, []);
    values.get(key).push({ fact, value });
  }
  return [...values.entries()].flatMap(([subject, entries]) => {
    const unique = [...new Set(entries.map((entry) => entry.value))];
    if (unique.length < 2) return [];
    return [{ conflictId: `conflict_${crypto.randomUUID()}`, subject, factIds: entries.map((entry) => entry.fact.factId), status: 'unresolved', blocking: true }];
  });
}

function buildAnalysis(set) {
  const evidence = [...set.items.flatMap((item) => item.evidence || []), ...(set.userCorrections || [])];
  const visibleEvidence = evidence.filter((item) => item.userStatus !== 'ignored' && !item.supersededBy);
  const imageObservations = visibleEvidence.filter((item) => item.evidenceClass === 'image_observation');
  const userClaims = visibleEvidence.filter((item) => item.evidenceClass === 'user_claim');
  const verifiedFacts = visibleEvidence.filter((item) => item.evidenceClass === 'verified_fact');
  const inferences = visibleEvidence.filter((item) => item.evidenceClass === 'inference');
  const factsForConflict = [...verifiedFacts, ...userClaims]
    .filter((item) => item.userStatus !== 'ignored' && !item.supersededBy && item.usableForClaims !== false);
  return {
    status: set.items.some((item) => ['queued', 'processing'].includes(item.status)) ? 'processing' : set.items.some((item) => ['failed', 'partial'].includes(item.status)) ? 'partial' : 'ready',
    imageObservations,
    verifiedFacts,
    userClaims,
    inferences,
    conflicts: detectConflicts(factsForConflict),
    unknowns: [...new Set(set.items.flatMap((item) => item.unknowns || []))],
    sourceSummaries: set.items.map((item) => ({ sourceId: item.sourceId, name: item.name, type: item.type, status: item.status, evidenceCount: item.evidence?.length || 0 })),
  };
}

export async function createMaterialSet({ instruction = '' } = {}) {
  const createdAt = now();
  const set = { materialSetId: `matset_${crypto.randomUUID()}`, revision: 1, instruction: instruction.trim(), status: 'ready', items: [], userCorrections: [], analysis: null, createdAt, updatedAt: createdAt };
  if (set.instruction) {
    const material = createTextMaterial(set.instruction, '创作说明');
    const item = { sourceId: 'instruction', type: 'user_text', name: '创作说明', status: 'ready', text: material.text, characterCount: material.characterCount, evidence: [] };
    item.evidence = textEvidence(item);
    set.items.push(item);
  }
  set.analysis = buildAnalysis(set);
  await putEntity('materialSets', set, 'materialSetId');
  return publicMaterialSet(set);
}

function fileType(file) {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (IMAGE_TYPES.has(file.mimetype)) return 'image';
  if (extension === '.pdf' || file.mimetype === 'application/pdf') return 'pdf';
  if (extension === '.docx' || /wordprocessingml/.test(file.mimetype || '')) return 'docx';
  if (extension === '.md' || extension === '.markdown' || file.mimetype === 'text/markdown') return 'markdown';
  return 'text';
}

function contentHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function fileToItem(set, file, visionClient, existing = {}) {
  if (file.size > MAX_FILE_SIZE || file.buffer.length > MAX_FILE_SIZE) throw materialError('MATERIAL_TOO_LARGE', '单个文件不能超过 20 MB');
  const sourceId = existing.sourceId || `src_${crypto.randomUUID()}`;
  if (IMAGE_TYPES.has(file.mimetype)) {
    const extension = path.extname(file.originalname || '') || `.${file.mimetype.split('/')[1]}`;
    const storagePath = existing.storagePath || await saveMaterialAsset(set.materialSetId, sourceId, extension, file.buffer);
    const dimensions = imageDimensions(file.buffer, file.mimetype);
    const item = { ...existing, sourceId, type: 'image', name: file.originalname || '产品截图', mimeType: file.mimetype, size: file.buffer.length, contentHash: existing.contentHash || contentHash(file.buffer), ...dimensions, storagePath, status: 'processing', evidence: [], unknowns: [] };
    try {
      const vision = await runAdapterOperation({
        adapterKey: 'vision:material',
        adapterVersion: process.env.NARRAFORM_VISION_MODEL || 'unconfigured',
        action: 'analyze_image',
        operationId: sourceId,
        execute: () => visionClient({ buffer: file.buffer, mimeType: file.mimetype, name: item.name }),
      });
      item.analysisStatus = vision.status;
      item.ocrText = vision.ocrText || '';
      item.unknowns = vision.unknowns || [];
      item.evidence = (vision.observations || []).map((observation) => ({
        factId: `obs_${crypto.randomUUID()}`,
        statement: normalizeStatement(observation.statement),
        evidenceClass: 'image_observation',
        sourceType: 'image',
        sourceId,
        locator: observation.locator || { x: 0, y: 0, width: dimensions.width, height: dimensions.height },
        confidence: Math.max(0, Math.min(1, Number(observation.confidence ?? 0.5))),
        usableForClaims: false,
        userStatus: 'unreviewed',
      })).filter((item) => item.statement.length >= 4);
      item.status = vision.status === 'ready' ? 'ready' : 'partial';
    } catch (error) {
      item.status = 'partial'; item.analysisStatus = 'analysis_unavailable'; item.unknowns = [error.message]; item.errorCode = error.code || 'VISION_UNAVAILABLE';
    }
    return item;
  }
  const parsed = await parseUploadedFile(file);
  const item = { ...existing, sourceId, type: fileType(file), name: parsed.displayName, mimeType: parsed.mimeType, size: file.buffer.length, contentHash: existing.contentHash || contentHash(file.buffer), status: 'ready', text: parsed.text, segments: parsed.segments || [], characterCount: parsed.characterCount, evidence: [] };
  item.evidence = textEvidence(item);
  return item;
}

async function inputToItem(input, existing = {}) {
  const sourceId = existing.sourceId || `src_${crypto.randomUUID()}`;
  if (input.type === 'url') {
    const parsed = await fetchWebMaterial(input.url);
    const item = { ...existing, sourceId, type: 'url', name: parsed.displayName, url: parsed.url, contentHash: existing.contentHash || contentHash(parsed.url), status: 'ready', text: parsed.text, characterCount: parsed.characterCount, evidence: [] };
    item.evidence = textEvidence(item); return item;
  }
  if (input.type === 'user_text' || input.type === 'text') {
    const parsed = createTextMaterial(input.text ?? input.inputText, input.name || '补充说明');
    const item = { ...existing, sourceId, type: 'user_text', name: parsed.displayName, contentHash: existing.contentHash || contentHash(parsed.text), status: 'ready', text: parsed.text, characterCount: parsed.characterCount, evidence: [] };
    item.evidence = textEvidence(item); return item;
  }
  throw materialError('MATERIAL_TYPE_UNSUPPORTED', '仅支持图片、TXT、Markdown、PDF、DOCX、网页或粘贴文字');
}

export async function addMaterialSetItems(materialSetId, { files = [], items = [], visionClient = defaultVisionClient } = {}) {
  const set = await getEntity('materialSets', materialSetId, 'materialSetId');
  if (!set) throw materialError('MATERIAL_SET_NOT_FOUND', '没有找到这组创作资料', 404);
  if (set.items.length + files.length + items.length > MAX_ITEMS) throw materialError('MATERIAL_LIMIT_EXCEEDED', '一组资料最多包含 20 项');
  const added = [];
  for (const file of files) {
    try { added.push(await fileToItem(set, file, visionClient)); }
    catch (error) { added.push({ sourceId: `src_${crypto.randomUUID()}`, type: 'file', name: file.originalname || '文件', status: 'failed', errorCode: error.code || 'MATERIAL_PARSE_FAILED', error: error.message, evidence: [], unknowns: [] }); }
  }
  for (const input of items) {
    try { added.push(await inputToItem(input)); }
    catch (error) { added.push({ sourceId: `src_${crypto.randomUUID()}`, type: input.type || 'unknown', name: input.name || input.url || '资料', status: 'failed', errorCode: error.code || 'MATERIAL_PARSE_FAILED', error: error.message, evidence: [], unknowns: [] }); }
  }
  set.items.push(...added);
  set.revision += 1;
  set.updatedAt = now();
  set.analysis = buildAnalysis(set);
  set.status = set.analysis.status;
  await putEntity('materialSets', set, 'materialSetId');
  return { materialSet: publicMaterialSet(set), added: added.map(publicItem) };
}

async function createQueuedFile(set, file) {
  const size = Number(file.size ?? file.buffer?.length ?? 0);
  if (!file.buffer || size > MAX_FILE_SIZE) throw materialError('MATERIAL_TOO_LARGE', '单个文件不能超过 20 MB');
  const sourceId = `src_${crypto.randomUUID()}`;
  const extension = path.extname(file.originalname || '') || (IMAGE_TYPES.has(file.mimetype) ? `.${file.mimetype.split('/')[1]}` : '.bin');
  const storagePath = await saveMaterialAsset(set.materialSetId, sourceId, extension, file.buffer);
  return {
    sourceId,
    type: fileType(file),
    inputKind: 'file',
    name: file.originalname || '资料文件',
    mimeType: file.mimetype,
    size,
    contentHash: contentHash(file.buffer),
    storagePath,
    status: 'queued',
    evidence: [],
    unknowns: [],
  };
}

function createQueuedInput(input) {
  const sourceId = `src_${crypto.randomUUID()}`;
  if (input.type === 'url') {
    const url = String(input.url || '').trim();
    if (!url) throw materialError('MATERIAL_URL_REQUIRED', '请输入要读取的网页地址');
    return { sourceId, type: 'url', inputKind: 'url', name: input.name || url || '网页资料', url, contentHash: contentHash(url), status: 'queued', evidence: [], unknowns: [] };
  }
  if (input.type === 'user_text' || input.type === 'text') {
    const inputText = String(input.text || '').trim();
    if (!inputText) throw materialError('MATERIAL_TEXT_REQUIRED', '请输入要整理的文字内容');
    return { sourceId, type: 'user_text', inputKind: 'user_text', name: input.name || '补充说明', inputText, contentHash: contentHash(inputText), status: 'queued', evidence: [], unknowns: [] };
  }
  return { sourceId, type: input.type || 'unknown', inputKind: 'unsupported', name: input.name || '资料', contentHash: contentHash(JSON.stringify(input)), status: 'queued', evidence: [], unknowns: [] };
}

export async function queueMaterialSetItems(materialSetId, { files = [], items = [] } = {}) {
  const set = await getEntity('materialSets', materialSetId, 'materialSetId');
  if (!set) throw materialError('MATERIAL_SET_NOT_FOUND', '没有找到这组创作资料', 404);
  if (set.items.length + files.length + items.length > MAX_ITEMS) throw materialError('MATERIAL_LIMIT_EXCEEDED', '一组资料最多包含 20 项');
  const candidates = [];
  for (const file of files) candidates.push(await createQueuedFile(set, file));
  for (const input of items) candidates.push(createQueuedInput(input));
  const knownHashes = new Set(set.items.map((item) => item.contentHash).filter(Boolean));
  const queued = [];
  const duplicates = [];
  for (const item of candidates) {
    if (item.contentHash && knownHashes.has(item.contentHash)) {
      duplicates.push(item);
      if (item.storagePath) await removeMaterialAsset(item.storagePath);
      continue;
    }
    knownHashes.add(item.contentHash);
    queued.push(item);
  }
  set.items.push(...queued);
  set.revision += 1;
  set.updatedAt = now();
  set.analysis = buildAnalysis(set);
  set.status = set.analysis.status;
  await putEntity('materialSets', set, 'materialSetId');
  if (!queued.length) return { materialSet: publicMaterialSet(set), job: null, queued: [], duplicates: duplicates.map(publicItem) };
  const job = {
    jobId: `matjob_${crypto.randomUUID()}`,
    materialSetId,
    itemIds: queued.map((item) => item.sourceId),
    status: 'queued',
    attempts: 0,
    events: [{ type: 'analysis.queued', itemCount: queued.length, at: now() }],
    createdAt: now(),
    updatedAt: now(),
  };
  await putEntity('materialAnalysisJobs', job, 'jobId');
  setImmediate(() => { void enqueueMaterialAnalysis(job.jobId); });
  return { materialSet: publicMaterialSet(set), job, queued: queued.map(publicItem), duplicates: duplicates.map(publicItem) };
}

async function processQueuedMaterialItem(set, item, visionClient) {
  if (item.inputKind === 'file') {
    const buffer = await readMaterialAsset(item.storagePath);
    return fileToItem(set, { originalname: item.name, mimetype: item.mimeType, size: item.size, buffer }, visionClient, item);
  }
  if (item.inputKind === 'url') return inputToItem({ type: 'url', url: item.url, name: item.name }, item);
  if (item.inputKind === 'user_text') return inputToItem({ type: 'user_text', inputText: item.inputText, name: item.name }, item);
  throw materialError('MATERIAL_TYPE_UNSUPPORTED', '仅支持图片、TXT、Markdown、PDF、DOCX、网页或粘贴文字');
}

export async function runMaterialAnalysisJob(jobId, { visionClient = defaultVisionClient } = {}) {
  let job = await getEntity('materialAnalysisJobs', jobId, 'jobId');
  if (!job) throw materialError('MATERIAL_ANALYSIS_JOB_NOT_FOUND', '没有找到素材分析任务', 404);
  job.status = 'processing'; job.attempts += 1; job.updatedAt = now();
  job.events.push({ type: 'analysis.started', at: now() });
  await putEntity('materialAnalysisJobs', job, 'jobId');
  for (const sourceId of job.itemIds) {
    let set = await getEntity('materialSets', job.materialSetId, 'materialSetId');
    if (!set) { job.status = 'cancelled'; break; }
    const index = set.items.findIndex((item) => item.sourceId === sourceId);
    if (index < 0 || ['ready', 'partial'].includes(set.items[index].status)) continue;
    set.items[index].status = 'processing'; set.updatedAt = now(); set.analysis = buildAnalysis(set); set.status = set.analysis.status;
    await putEntity('materialSets', set, 'materialSetId');
    job.events.push({ type: 'item.parsing', sourceId, at: now() });
    try {
      const parsed = await processQueuedMaterialItem(set, set.items[index], visionClient);
      set = await getEntity('materialSets', job.materialSetId, 'materialSetId');
      if (!set) { job.status = 'cancelled'; break; }
      const currentIndex = set.items.findIndex((item) => item.sourceId === sourceId);
      if (currentIndex < 0) continue;
      set.items[currentIndex] = parsed;
      job.events.push({ type: parsed.status === 'ready' ? 'item.ready' : 'item.partial', sourceId, at: now() });
    } catch (error) {
      set = await getEntity('materialSets', job.materialSetId, 'materialSetId');
      if (!set) { job.status = 'cancelled'; break; }
      const current = set.items.find((item) => item.sourceId === sourceId);
      if (current) { current.status = 'failed'; current.errorCode = error.code || 'MATERIAL_PARSE_FAILED'; current.error = error.message; }
      job.events.push({ type: 'item.failed', sourceId, code: error.code || 'MATERIAL_PARSE_FAILED', at: now() });
    }
    set.revision += 1; set.updatedAt = now(); set.analysis = buildAnalysis(set); set.status = set.analysis.status;
    await putEntity('materialSets', set, 'materialSetId');
    job.updatedAt = now(); await putEntity('materialAnalysisJobs', job, 'jobId');
  }
  if (job.status !== 'cancelled') {
    const set = await getEntity('materialSets', job.materialSetId, 'materialSetId');
    const items = job.itemIds.map((id) => set?.items.find((item) => item.sourceId === id)).filter(Boolean);
    job.status = items.some((item) => item.status === 'failed') ? 'partial' : 'completed';
    job.events.push({ type: 'analysis.completed', status: job.status, at: now() });
  }
  job.updatedAt = now(); await putEntity('materialAnalysisJobs', job, 'jobId');
  return job;
}

export function enqueueMaterialAnalysis(jobId, options = {}) {
  if (analysisRuns.has(jobId)) return analysisRuns.get(jobId);
  const run = runMaterialAnalysisJob(jobId, options).finally(() => analysisRuns.delete(jobId));
  analysisRuns.set(jobId, run);
  return run;
}

export async function getMaterialAnalysisJob(jobId) {
  return getEntity('materialAnalysisJobs', jobId, 'jobId');
}

export async function getMaterialAnalysisEvents(jobId, after = 0) {
  const job = await getMaterialAnalysisJob(jobId);
  if (!job) throw materialError('MATERIAL_ANALYSIS_JOB_NOT_FOUND', '没有找到素材分析任务', 404);
  const cursor = Math.max(0, Number(after) || 0);
  return { jobId, status: job.status, events: (job.events || []).slice(cursor), nextCursor: job.events?.length || 0 };
}

export async function waitForMaterialAnalysis(jobId, options = {}) {
  const job = await getMaterialAnalysisJob(jobId);
  if (!job) throw materialError('MATERIAL_ANALYSIS_JOB_NOT_FOUND', '没有找到素材分析任务', 404);
  if (['completed', 'partial', 'cancelled'].includes(job.status)) return job;
  return enqueueMaterialAnalysis(jobId, options);
}

export async function retryMaterialItem(materialSetId, sourceId) {
  const set = await getEntity('materialSets', materialSetId, 'materialSetId');
  const item = set?.items.find((entry) => entry.sourceId === sourceId);
  if (!set || !item) throw materialError('MATERIAL_ITEM_NOT_FOUND', '没有找到这项资料', 404);
  item.status = 'queued'; delete item.error; delete item.errorCode; item.evidence = []; item.unknowns = [];
  set.revision += 1; set.updatedAt = now(); set.analysis = buildAnalysis(set); set.status = set.analysis.status;
  await putEntity('materialSets', set, 'materialSetId');
  const job = { jobId: `matjob_${crypto.randomUUID()}`, materialSetId, itemIds: [sourceId], status: 'queued', attempts: 0, events: [{ type: 'analysis.queued', itemCount: 1, at: now() }], createdAt: now(), updatedAt: now() };
  await putEntity('materialAnalysisJobs', job, 'jobId');
  setImmediate(() => { void enqueueMaterialAnalysis(job.jobId); });
  return { materialSet: publicMaterialSet(set), job };
}

export async function deleteMaterialItem(materialSetId, sourceId) {
  const set = await getEntity('materialSets', materialSetId, 'materialSetId');
  if (!set) throw materialError('MATERIAL_SET_NOT_FOUND', '没有找到这组创作资料', 404);
  const index = set.items.findIndex((item) => item.sourceId === sourceId);
  if (index < 0) throw materialError('MATERIAL_ITEM_NOT_FOUND', '没有找到这项资料', 404);
  const [removed] = set.items.splice(index, 1);
  if (removed.storagePath) await removeMaterialAsset(removed.storagePath);
  set.revision += 1; set.updatedAt = now(); set.analysis = buildAnalysis(set); set.status = set.analysis.status;
  await putEntity('materialSets', set, 'materialSetId');
  return publicMaterialSet(set);
}

export async function resumePendingMaterialAnalysisJobs() {
  const jobs = (await listEntities('materialAnalysisJobs')).filter((job) => ['queued', 'processing'].includes(job.status));
  for (const job of jobs) setImmediate(() => { void enqueueMaterialAnalysis(job.jobId); });
  return jobs.length;
}

export async function getMaterialSet(materialSetId) {
  const set = await getEntity('materialSets', materialSetId, 'materialSetId');
  return set ? publicMaterialSet(set) : null;
}

export async function getMaterialSetInternal(materialSetId) {
  return getEntity('materialSets', materialSetId, 'materialSetId');
}

export function publicMaterialSet(set) {
  return { ...set, items: set.items.map(publicItem) };
}

export async function updateMaterialFact(materialSetId, factId, patch = {}, baseRevision) {
  const updated = await updateEntity('materialSets', materialSetId, (set) => {
    if (baseRevision !== undefined && Number(baseRevision) !== Number(set.revision)) throw materialError('MATERIAL_REVISION_CONFLICT', '资料已经更新，请刷新后继续', 409);
    let target;
    for (const item of set.items) {
      target = item.evidence?.find((fact) => fact.factId === factId);
      if (target) break;
    }
    target ||= set.userCorrections?.find((fact) => fact.factId === factId);
    if (!target) throw materialError('MATERIAL_FACT_NOT_FOUND', '没有找到这条资料信息', 404);
    set.userCorrections ||= [];
    const requestedStatus = ['confirmed', 'corrected', 'ignored', 'unreviewed'].includes(patch.userStatus) ? patch.userStatus : null;
    const correctedStatement = patch.statement?.trim();
    const editingCorrection = target.sourceType === 'user_correction' && Boolean(correctedStatement);
    const needsDerivedFact = !editingCorrection && (target.evidenceClass === 'image_observation' && ['confirmed', 'corrected'].includes(requestedStatus)
      || Boolean(correctedStatement && correctedStatement !== target.statement));
    if (requestedStatus) target.userStatus = requestedStatus;
    if (editingCorrection) {
      target.statement = correctedStatement;
      target.userStatus = 'confirmed';
      target.usableForClaims = true;
    }
    if (requestedStatus === 'ignored') {
      const derived = set.userCorrections.find((fact) => fact.derivedFrom === target.factId);
      if (derived) derived.userStatus = 'ignored';
      target.usableForClaims = false;
    } else if (needsDerivedFact) {
      let derived = set.userCorrections.find((fact) => fact.derivedFrom === target.factId);
      if (!derived) {
        derived = {
          factId: `fact_${crypto.randomUUID()}`,
          statement: correctedStatement || target.statement,
          evidenceClass: 'verified_fact',
          sourceType: 'user_correction',
          sourceId: target.sourceId,
          locator: { ...(target.locator || {}), derivedFrom: target.factId },
          confidence: 1,
          usableForClaims: true,
          userStatus: 'confirmed',
          derivedFrom: target.factId,
        };
        set.userCorrections.push(derived);
      } else {
        derived.statement = correctedStatement || target.statement;
        derived.userStatus = 'confirmed';
        derived.usableForClaims = true;
      }
      target.derivedFactId = derived.factId;
      target.usableForClaims = false;
      if (correctedStatement && correctedStatement !== target.statement) target.supersededBy = derived.factId;
    }
    set.revision += 1; set.updatedAt = now(); set.analysis = buildAnalysis(set); set.status = set.analysis.status;
    return set;
  }, 'materialSetId');
  return updated ? publicMaterialSet(updated) : null;
}

export async function resolveMaterialConflicts(materialSetId, resolutions = [], baseRevision) {
  const updated = await updateEntity('materialSets', materialSetId, (set) => {
    if (baseRevision !== undefined && Number(baseRevision) !== Number(set.revision)) throw materialError('MATERIAL_REVISION_CONFLICT', '资料已经更新，请刷新后继续', 409);
    for (const resolution of resolutions) {
      const facts = [...set.items.flatMap((item) => item.evidence || []), ...(set.userCorrections || [])];
      for (const fact of facts) {
        if (resolution.keepFactId === fact.factId) fact.userStatus = 'confirmed';
        if ((resolution.ignoreFactIds || []).includes(fact.factId)) fact.userStatus = 'ignored';
      }
    }
    set.revision += 1; set.updatedAt = now(); set.analysis = buildAnalysis(set); set.status = set.analysis.status; return set;
  }, 'materialSetId');
  return updated ? publicMaterialSet(updated) : null;
}

export async function getMaterialAsset(materialSetId, sourceId) {
  const set = await getEntity('materialSets', materialSetId, 'materialSetId');
  const item = set?.items.find((entry) => entry.sourceId === sourceId && entry.storagePath);
  if (!item) return null;
  return { buffer: await readMaterialAsset(item.storagePath), mimeType: item.mimeType, name: item.name };
}

export async function deleteMaterialSet(materialSetId) {
  const removed = await deleteEntity('materialSets', materialSetId, 'materialSetId');
  if (removed) {
    await removeMaterialSetAssets(materialSetId);
    const jobs = (await listEntities('materialAnalysisJobs')).filter((job) => job.materialSetId === materialSetId);
    await Promise.all(jobs.map((job) => deleteEntity('materialAnalysisJobs', job.jobId, 'jobId')));
  }
  return Boolean(removed);
}

export function factSetFromMaterialSet(set) {
  const analysis = set.analysis || buildAnalysis(set);
  const usable = [...analysis.verifiedFacts, ...analysis.userClaims]
    .filter((item) => item.userStatus !== 'ignored' && !item.supersededBy && item.usableForClaims !== false);
  return {
    verifiedFacts: usable,
    facts: usable,
    opinions: [],
    experiences: [],
    unknowns: analysis.unknowns,
    claimsRequiringConfirmation: analysis.imageObservations.filter((item) => !['confirmed', 'corrected', 'ignored'].includes(item.userStatus)),
    conflicts: analysis.conflicts.filter((item) => item.status === 'unresolved'),
    knownNumbers: [...new Set(usable.flatMap((item) => item.statement.match(/\d+(?:\.\d+)?(?:%|倍|万|元|天|小时|分钟)?/g) || []))],
    sourceMetadata: set.items.map((item) => ({ sourceId: item.sourceId, displayName: item.name, externalizable: false })),
  };
}
