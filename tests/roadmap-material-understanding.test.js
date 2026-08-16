import test from 'node:test';
import assert from 'node:assert/strict';
import { addMaterialSetItems, createMaterialSet, deleteMaterialItem, factSetFromMaterialSet, getMaterialAnalysisEvents, getMaterialSet, getMaterialSetInternal, queueMaterialSetItems, resolveMaterialConflicts, retryMaterialItem, updateMaterialFact, waitForMaterialAnalysis } from '../server/material-understanding.js';
import { resetRoadmapStore } from '../server/roadmap-store.js';

test.beforeEach(async () => resetRoadmapStore());

function pngBuffer(width = 1440, height = 960) {
  const buffer = Buffer.alloc(32);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test('PR-02 截图、用户说明和文档进入统一 MaterialSet 且证据分级', async () => {
  const created = await createMaterialSet({ instruction: 'CodeLoop 是一个协助完成编码任务的 Agent。' });
  const output = await addMaterialSetItems(created.materialSetId, {
    files: [
      { originalname: 'codeloop-run.png', mimetype: 'image/png', size: 32, buffer: pngBuffer() },
      { originalname: '产品功能说明.md', mimetype: 'text/markdown', size: 96, buffer: Buffer.from('CodeLoop 可以读取用户授权的代码仓库。\n\nCodeLoop 可以修改代码并运行项目测试。') },
    ],
    visionClient: async () => ({
      status: 'ready',
      observations: [{ statement: '界面左侧显示读取仓库、修改文件和运行测试三个步骤', locator: { x: 118, y: 186, width: 322, height: 438 }, confidence: 0.92 }],
      ocrText: '执行计划 读取仓库 修改文件 运行测试',
      unknowns: ['截图不能证明任务执行是否完全自动'],
    }),
  });
  assert.equal(output.materialSet.items.length, 3);
  assert.equal(output.materialSet.analysis.userClaims.length, 1);
  assert.equal(output.materialSet.analysis.verifiedFacts.length, 2);
  assert.equal(output.materialSet.analysis.imageObservations.length, 1);
  assert.equal(output.materialSet.analysis.imageObservations[0].usableForClaims, false);
  assert.equal(output.materialSet.analysis.imageObservations[0].locator.x, 118);
  assert.deepEqual(output.materialSet.analysis.unknowns, ['截图不能证明任务执行是否完全自动']);
});

test('PR-02 图片观察只有经用户确认后才能进入生成 FactSet', async () => {
  const created = await createMaterialSet({ instruction: '介绍 CodeLoop。' });
  const added = await addMaterialSetItems(created.materialSetId, {
    files: [{ originalname: 'run.png', mimetype: 'image/png', size: 32, buffer: pngBuffer() }],
    visionClient: async () => ({ status: 'ready', observations: [{ statement: '界面显示测试通过状态', confidence: 0.88 }], unknowns: [] }),
  });
  const observation = added.materialSet.analysis.imageObservations[0];
  let factSet = factSetFromMaterialSet(await getMaterialSetInternal(created.materialSetId));
  assert.equal(factSet.verifiedFacts.some((fact) => fact.statement === observation.statement), false);

  const confirmed = await updateMaterialFact(created.materialSetId, observation.factId, { userStatus: 'confirmed' }, added.materialSet.revision);
  assert.equal(confirmed.analysis.imageObservations[0].usableForClaims, false);
  const derived = confirmed.analysis.verifiedFacts.find((fact) => fact.derivedFrom === observation.factId);
  assert.ok(derived);
  assert.equal(derived.sourceType, 'user_correction');
  assert.notEqual(derived.factId, observation.factId);
  factSet = factSetFromMaterialSet(await getMaterialSetInternal(created.materialSetId));
  assert.equal(factSet.verifiedFacts.some((fact) => fact.factId === derived.factId && fact.statement === observation.statement), true);
});

test('PR-02 用户修正保留原证据，并以派生事实覆盖创作上下文', async () => {
  const created = await createMaterialSet();
  const added = await addMaterialSetItems(created.materialSetId, {
    items: [{ type: 'user_text', text: 'CodeLoop 支持所有编程语言。' }],
  });
  const original = added.materialSet.analysis.userClaims[0];
  const corrected = await updateMaterialFact(created.materialSetId, original.factId, {
    statement: 'CodeLoop 可以读取用户授权的代码仓库。',
    userStatus: 'corrected',
  }, added.materialSet.revision);
  const internal = await getMaterialSetInternal(created.materialSetId);
  const storedOriginal = internal.items.flatMap((item) => item.evidence).find((fact) => fact.factId === original.factId);
  assert.equal(storedOriginal.statement, original.statement);
  assert.ok(storedOriginal.supersededBy);
  assert.equal(corrected.analysis.userClaims.some((fact) => fact.factId === original.factId), false);
  const factSet = factSetFromMaterialSet(internal);
  assert.deepEqual(factSet.verifiedFacts.map((fact) => fact.statement), ['CodeLoop 可以读取用户授权的代码仓库。']);
});

test('PR-02 文档事实保留段落定位，冲突由用户选择后消解', async () => {
  const created = await createMaterialSet();
  const added = await addMaterialSetItems(created.materialSetId, {
    files: [{ originalname: '产品说明.md', mimetype: 'text/markdown', size: 80, buffer: Buffer.from('# 产品说明\n\nCodeLoop 支持 Python。\n\nCodeLoop 支持 Java。') }],
  });
  const python = added.materialSet.analysis.verifiedFacts.find((fact) => /Python/.test(fact.statement));
  assert.equal(python.locator.paragraph, 2);
  assert.equal(added.materialSet.analysis.conflicts.length, 1);
  const conflict = added.materialSet.analysis.conflicts[0];
  const resolved = await resolveMaterialConflicts(created.materialSetId, [{
    keepFactId: python.factId,
    ignoreFactIds: conflict.factIds.filter((factId) => factId !== python.factId),
  }], added.materialSet.revision);
  assert.equal(resolved.analysis.conflicts.length, 0);
  const factSet = factSetFromMaterialSet(await getMaterialSetInternal(created.materialSetId));
  assert.equal(factSet.verifiedFacts.some((fact) => /Python/.test(fact.statement)), true);
  assert.equal(factSet.verifiedFacts.some((fact) => /Java/.test(fact.statement)), false);
});

test('PR-02 未配置视觉模型时诚实降级，不根据文件名伪造观察', async () => {
  const created = await createMaterialSet({ instruction: '介绍产品。' });
  const output = await addMaterialSetItems(created.materialSetId, {
    files: [{ originalname: '支持十倍提效.png', mimetype: 'image/png', size: 32, buffer: pngBuffer() }],
    visionClient: async () => ({ status: 'analysis_unavailable', observations: [], ocrText: '', unknowns: ['当前没有配置图片理解模型'] }),
  });
  assert.equal(output.materialSet.analysis.imageObservations.length, 0);
  assert.equal(output.materialSet.analysis.status, 'partial');
  assert.match(output.materialSet.analysis.unknowns.join(' '), /没有配置图片理解模型/);
  const publicClaims = [...output.materialSet.analysis.verifiedFacts, ...output.materialSet.analysis.userClaims, ...output.materialSet.analysis.imageObservations];
  assert.doesNotMatch(publicClaims.map((item) => item.statement).join(' '), /十倍提效/);
});

test('PR-02 素材任务先持久排队，后台完成并保留逐项事件', async () => {
  const created = await createMaterialSet();
  const queued = await queueMaterialSetItems(created.materialSetId, {
    items: [{ type: 'user_text', text: 'CodeLoop 可以读取用户授权的代码仓库，并运行项目测试。' }],
  });
  assert.equal(queued.materialSet.status, 'processing');
  assert.equal(queued.queued[0].status, 'queued');
  assert.equal(queued.job.status, 'queued');
  const completed = await waitForMaterialAnalysis(queued.job.jobId);
  assert.equal(completed.status, 'completed');
  const materialSet = await getMaterialSet(created.materialSetId);
  assert.equal(materialSet.status, 'ready');
  assert.equal(materialSet.analysis.userClaims.length, 1);
  assert.equal(materialSet.analysis.userClaims[0].sourceType, 'user_text');
  const eventPage = await getMaterialAnalysisEvents(queued.job.jobId, 1);
  assert.ok(eventPage.events.some((event) => event.type === 'item.ready'));
  assert.equal(eventPage.nextCursor, completed.events.length);
});

test('PR-02 相同素材去重，失败项可单独重试和删除', async () => {
  const created = await createMaterialSet();
  const first = await queueMaterialSetItems(created.materialSetId, { items: [{ type: 'user_text', text: '一段足够长且可以提取为事实的产品说明内容。' }] });
  await waitForMaterialAnalysis(first.job.jobId);
  const duplicate = await queueMaterialSetItems(created.materialSetId, { items: [{ type: 'user_text', text: '一段足够长且可以提取为事实的产品说明内容。' }] });
  assert.equal(duplicate.job, null);
  assert.equal(duplicate.duplicates.length, 1);
  assert.equal(duplicate.materialSet.items.length, 1);

  const invalid = await queueMaterialSetItems(created.materialSetId, { items: [{ type: 'unsupported', name: '未知格式' }] });
  const failedJob = await waitForMaterialAnalysis(invalid.job.jobId);
  assert.equal(failedJob.status, 'partial');
  let materialSet = await getMaterialSet(created.materialSetId);
  const failed = materialSet.items.find((item) => item.status === 'failed');
  assert.ok(failed);
  const retried = await retryMaterialItem(created.materialSetId, failed.sourceId);
  const retriedJob = await waitForMaterialAnalysis(retried.job.jobId);
  assert.equal(retriedJob.status, 'partial');
  materialSet = await deleteMaterialItem(created.materialSetId, failed.sourceId);
  assert.equal(materialSet.items.some((item) => item.sourceId === failed.sourceId), false);
});
