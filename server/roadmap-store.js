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
const assetDir = path.join(dataDir, 'material-assets');
const collections = new Set(['materialSets', 'materialAnalysisJobs', 'publishPackages', 'deliveryJobs', 'deliveryReceipts', 'performanceSnapshots', 'retrospectiveInsights', 'learningRules', 'runtimeEvents']);
const queues = new Map();

function collectionFile(name) {
  if (!collections.has(name)) throw new Error(`Unknown collection: ${name}`);
  return path.join(dataDir, `${name}.json`);
}

async function ensureCollection(name) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = collectionFile(name);
  try { await fs.access(file); } catch { await fs.writeFile(file, '[]\n', 'utf8'); }
  return file;
}

async function readCollection(name) {
  const file = await ensureCollection(name);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
}

async function writeCollection(name, value) {
  const file = await ensureCollection(name);
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await fs.rename(temp, file).catch(async () => {
      await fs.copyFile(temp, file);
      await fs.rm(temp, { force: true });
    });
  } finally {
    await fs.rm(temp, { force: true });
  }
}

function mutate(name, operation) {
  const previous = queues.get(name) || Promise.resolve();
  const mutation = previous.then(async () => {
    const values = await readCollection(name);
    const result = await operation(values);
    await writeCollection(name, values);
    return result;
  });
  queues.set(name, mutation.catch(() => {}));
  return mutation;
}

export async function listEntities(name) {
  return readCollection(name);
}

export async function getEntity(name, id, idField = 'id') {
  return (await readCollection(name)).find((item) => item[idField] === id) || null;
}

export async function putEntity(name, entity, idField = 'id') {
  return mutate(name, async (values) => {
    const index = values.findIndex((item) => item[idField] === entity[idField]);
    const stored = structuredClone(entity);
    if (index >= 0) values[index] = stored; else values.push(stored);
    return stored;
  });
}

export async function updateEntity(name, id, update, idField = 'id') {
  return mutate(name, async (values) => {
    const entity = values.find((item) => item[idField] === id);
    if (!entity) return null;
    const next = typeof update === 'function' ? await update(structuredClone(entity)) : { ...entity, ...update };
    Object.keys(entity).forEach((key) => delete entity[key]);
    Object.assign(entity, next);
    return structuredClone(entity);
  });
}

export async function deleteEntity(name, id, idField = 'id') {
  return mutate(name, async (values) => {
    const index = values.findIndex((item) => item[idField] === id);
    if (index < 0) return null;
    return values.splice(index, 1)[0];
  });
}

export async function saveMaterialAsset(materialSetId, itemId, extension, buffer) {
  const safeExtension = /^\.[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : '.bin';
  const directory = path.join(assetDir, materialSetId);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${itemId}${safeExtension}`);
  await fs.writeFile(file, buffer);
  return file;
}

export async function readMaterialAsset(file) {
  const resolved = path.resolve(file);
  const root = path.resolve(assetDir);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Invalid material asset path');
  return fs.readFile(resolved);
}

export async function removeMaterialSetAssets(materialSetId) {
  const target = path.resolve(assetDir, materialSetId);
  if (!target.startsWith(`${path.resolve(assetDir)}${path.sep}`)) throw new Error('Invalid material set path');
  await fs.rm(target, { recursive: true, force: true });
}

export async function removeMaterialAsset(file) {
  const resolved = path.resolve(file);
  const root = path.resolve(assetDir);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Invalid material asset path');
  await fs.rm(resolved, { force: true });
}

export async function resetRoadmapStore() {
  await Promise.all([...queues.values()].map((queue) => queue.catch(() => {})));
  for (const name of collections) await writeCollection(name, []);
  await fs.rm(assetDir, { recursive: true, force: true });
}
