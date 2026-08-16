import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const testProcess = Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === 'test';
const dataDir = process.env.CONTENTFLOW_DATA_DIR
  ? path.resolve(process.env.CONTENTFLOW_DATA_DIR)
  : testProcess
    ? path.resolve(dirname, '..', '.test-data', String(process.pid))
    : path.resolve(dirname, '..', 'data');
const contentFile = path.join(dataDir, 'contents.json');
const materialFile = path.join(dataDir, 'materials.json');
const taskFile = path.join(dataDir, 'tasks.json');
let writeQueue = Promise.resolve();

async function ensureData() {
  await fs.mkdir(dataDir, { recursive: true });
  for (const file of [contentFile, materialFile, taskFile]) {
    try { await fs.access(file); } catch { await fs.writeFile(file, '[]\n', 'utf8'); }
  }
}

async function readJson(file) {
  await ensureData();
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
}

async function writeJson(file, value) {
  const operation = writeQueue.then(async () => {
    await ensureData();
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await fs.copyFile(temp, file);
    } finally {
      await fs.rm(temp, { force: true });
    }
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export async function saveMaterial(material) {
  const materials = await readJson(materialFile);
  const stored = { ...material, createdAt: new Date().toISOString() };
  materials.push(stored);
  await writeJson(materialFile, materials);
  return stored;
}

export async function getMaterials(ids = []) {
  const materials = await readJson(materialFile);
  return materials.filter((item) => ids.includes(item.id));
}

export async function saveTask(taskBrief) {
  const tasks = await readJson(taskFile);
  const index = tasks.findIndex((item) => item.taskId === taskBrief.taskId);
  const stored = { ...taskBrief, updatedAt: new Date().toISOString() };
  if (index >= 0) tasks[index] = stored; else tasks.push(stored);
  await writeJson(taskFile, tasks.slice(-200));
  return stored;
}

export async function getTask(taskId) {
  return (await readJson(taskFile)).find((item) => item.taskId === taskId) || null;
}

export async function selectTaskStrategy(taskId, strategyId) {
  const tasks = await readJson(taskFile);
  const task = tasks.find((item) => item.taskId === taskId);
  if (!task) return null;
  const strategy = task.strategyOptions?.find((item) => item.id === strategyId);
  if (!strategy) return null;
  task.selectedStrategyId = strategyId;
  task.status = 'ready_to_generate';
  task.version = Number(task.version || 1) + 1;
  task.updatedAt = new Date().toISOString();
  await writeJson(taskFile, tasks);
  return task;
}

export async function listContents() {
  const contents = await readJson(contentFile);
  return contents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ versions, ...item }) => ({
    ...item,
    versionCount: versions.length,
    latestVersion: versions.at(-1) || null,
  }));
}

export async function getContent(id) {
  return (await readJson(contentFile)).find((item) => item.id === id) || null;
}

export async function saveContent(payload) {
  const contents = await readJson(contentFile);
  const now = new Date().toISOString();
  const existingIndex = payload.id ? contents.findIndex((item) => item.id === payload.id) : -1;
  const version = {
    id: crypto.randomUUID(),
    createdAt: now,
    platform: payload.platform,
    titleCandidates: payload.titleCandidates || [],
    selectedTitleIndex: Number.isInteger(payload.selectedTitleIndex) ? payload.selectedTitleIndex : 0,
    summary: payload.summary || null,
    bodyMarkdown: payload.bodyMarkdown || '',
    topics: payload.topics || [],
    strategySnapshot: payload.strategySnapshot || {},
    factIds: payload.factIds || [],
    qualityReport: payload.qualityReport || {},
    specVersion: payload.specVersion || null,
    provider: payload.provider || null,
    taskId: payload.taskId || null,
    strategyId: payload.strategyId || null,
    platformMode: payload.platformMode || null,
    reason: payload.reason || 'save',
    resultId: payload.resultId || null,
    parentResultId: payload.parentResultId || null,
    operation: payload.operation || 'manual_save',
    operationId: payload.operationId || null,
    operationSpecVersion: payload.operationSpecVersion || null,
    changeSet: payload.changeSet || null,
    attempts: payload.attempts || null,
    platformSpecVersion: payload.platformSpecVersion || payload.specVersion || null,
    formatting: payload.formatting || null,
    formattingProfile: payload.formattingProfile || null,
    formattingOverride: payload.formattingOverride || null,
    removedTopics: payload.removedTopics || [],
  };
  if (existingIndex >= 0) {
    const existing = contents[existingIndex];
    contents[existingIndex] = {
      ...existing,
      name: payload.name || existing.name,
      platform: payload.platform || existing.platform,
      materialIds: payload.materialIds || existing.materialIds || [],
      updatedAt: now,
      status: 'saved',
      versions: [...existing.versions, version],
    };
    await writeJson(contentFile, contents);
    return contents[existingIndex];
  }
  const content = {
    id: crypto.randomUUID(),
    name: payload.name || payload.titleCandidates?.[0] || '未命名文案',
    platform: payload.platform,
    materialIds: payload.materialIds || [],
    createdAt: now,
    updatedAt: now,
    status: 'saved',
    versions: [version],
  };
  contents.push(content);
  await writeJson(contentFile, contents);
  return content;
}

export async function renameContent(id, name) {
  const contents = await readJson(contentFile);
  const content = contents.find((item) => item.id === id);
  if (!content) return null;
  content.name = name.trim() || content.name;
  content.updatedAt = new Date().toISOString();
  await writeJson(contentFile, contents);
  return content;
}

export async function deleteContent(id) {
  const contents = await readJson(contentFile);
  const target = contents.find((item) => item.id === id);
  if (!target) return false;
  await writeJson(contentFile, contents.filter((item) => item.id !== id));
  if (target.materialIds?.length) {
    const materials = await readJson(materialFile);
    await writeJson(materialFile, materials.filter((item) => !target.materialIds.includes(item.id)));
  }
  return true;
}

export async function resetStore() {
  await writeJson(contentFile, []);
  await writeJson(materialFile, []);
  await writeJson(taskFile, []);
}
