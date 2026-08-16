import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteContent, resetStore, saveContent } from '../server/store.js';
import { putEntity, resetRoadmapStore } from '../server/roadmap-store.js';
import { approveInsight, createPerformanceSnapshot, deletePerformanceByReceipt, deletePerformanceForContent, deletePerformanceSnapshot, dismissInsight, generateRetrospective, getStrategyContext, listContentPerformance, listLearningRules, normalizeMetrics, syncPerformanceSnapshot } from '../server/performance-learning.js';

test.beforeEach(async () => { await resetStore(); await resetRoadmapStore(); });

async function content(name) {
  return saveContent({
    name,
    platform: 'xiaohongshu',
    titleCandidates: [name],
    bodyMarkdown: `${name} 的正文`,
    strategySnapshot: { goal: 'save', contentType: 'product_marketing' },
  });
}

test('PR-04 缺失指标保持缺失，不被当作 0', () => {
  const normalized = normalizeMetrics({ impressions: 1000, saves: 30 });
  assert.equal(normalized.reads, undefined);
  assert.equal(normalized.saveRate.value, 0.03);
  assert.equal(normalized.saveRate.formula, 'saves / exposures');
  assert.equal(normalizeMetrics({ impressions: 1000 }).saveRate, undefined);
});

test('PR-04 平台指标连接器保留来源和原始字段，失败不产生伪快照', async () => {
  const current = await content('平台同步内容');
  const snapshot = await syncPerformanceSnapshot({ contentId: current.id, contentRevision: 1, platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48 }, {
    connector: async () => ({ source: 'browser', metrics: { views: 1200, favorites: 66 }, dataQuality: 'partial' }),
  });
  assert.equal(snapshot.source, 'browser');
  assert.equal(snapshot.rawMetrics.views, 1200);
  assert.equal(snapshot.normalizedMetrics.reads, 1200);
  assert.equal(snapshot.normalizedMetrics.saves, 66);
  await assert.rejects(
    () => syncPerformanceSnapshot({ contentId: current.id }, { connector: async () => { throw new Error('connector offline'); } }),
    /connector offline/,
  );
  assert.equal((await listContentPerformance(current.id)).length, 1);
});

test('PR-04 绑定发布回执时按真实提交时间计算内容年龄', async () => {
  const current = await content('回执绑定内容');
  const receipt = {
    receiptId: 'rcpt_age_contract', contentId: current.id, contentRevision: 1,
    platform: 'xiaohongshu', submittedAt: '2026-08-16T08:00:00.000Z',
    verified: true, status: 'delivered',
  };
  await putEntity('deliveryReceipts', receipt, 'receiptId');
  const snapshot = await createPerformanceSnapshot({
    contentId: current.id, contentRevision: 1, receiptId: receipt.receiptId,
    capturedAt: '2026-08-17T14:00:00.000Z', ageHours: 999,
    source: 'manual', metrics: { reads: 1200 },
  });
  assert.equal(snapshot.ageHours, 30);
  assert.equal(snapshot.publicationLinkStatus, 'verified');
});

test('PR-04 未绑定回执的时间必须有效，相同采集时点自动去重', async () => {
  const current = await content('快照去重内容');
  await assert.rejects(
    () => createPerformanceSnapshot({ contentId: current.id, source: 'manual', ageHours: -1, metrics: { reads: 1 } }),
    (error) => error.code === 'PERFORMANCE_AGE_INVALID',
  );
  const input = { contentId: current.id, source: 'manual', ageHours: 12, capturedAt: '2026-08-17T00:00:00.000Z', metrics: { reads: 300 }, dataQuality: 'partial' };
  const first = await createPerformanceSnapshot(input);
  const duplicate = await createPerformanceSnapshot(input);
  assert.equal(duplicate.snapshotId, first.snapshotId);
  assert.equal((await listContentPerformance(current.id)).length, 1);
  assert.equal(first.publicationLinkStatus, 'unlinked');
});

test('PR-04 样本少于 5 条时只返回数据，不生成趋势建议', async () => {
  const current = await content('当前内容');
  await createPerformanceSnapshot({ contentId: current.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 1000, saves: 60 } });
  for (let index = 0; index < 4; index += 1) {
    const baseline = await content(`基线 ${index}`);
    await createPerformanceSnapshot({ contentId: baseline.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 1000, saves: 30 } });
  }
  const result = await generateRetrospective(current.id);
  assert.equal(result.baseline.status, 'insufficient');
  assert.equal(result.baseline.sampleSize, 4);
  assert.equal(result.insight, null);
});

test('PR-04 同类基线产生证据化建议，批准后才进入策略上下文', async () => {
  const current = await content('CodeLoop 产品介绍');
  await createPerformanceSnapshot({ contentId: current.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { impressions: 18420, reads: 15107, likes: 612, saves: 941, comments: 83 } });
  const rates = [0.029, 0.031, 0.034, 0.037, 0.041, 0.033];
  for (let index = 0; index < rates.length; index += 1) {
    const baseline = await content(`同类内容 ${index + 1}`);
    await createPerformanceSnapshot({ contentId: baseline.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 10000, saves: Math.round(10000 * rates[index]) } });
  }
  const result = await generateRetrospective(current.id);
  assert.equal(result.baseline.status, 'available');
  assert.equal(result.baseline.sampleSize, 6);
  assert.match(result.insight.observation, /收藏率高于/);
  assert.equal(result.insight.causalClaim, false);
  assert.equal((await getStrategyContext({ platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing' })).length, 0);

  const rule = await approveInsight(result.insight.insightId);
  assert.equal(rule.status, 'active');
  const context = await getStrategyContext({ platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing' });
  assert.equal(context.length, 1);
  assert.equal(context[0].sourceInsightId, result.insight.insightId);
});

test('PR-04 用户忽略的建议不能再被批准', async () => {
  const current = await content('忽略建议内容');
  await createPerformanceSnapshot({ contentId: current.id, source: 'manual', ageHours: 48, metrics: { reads: 1000, saves: 90 } });
  for (let index = 0; index < 5; index += 1) {
    const baseline = await content(`忽略基线 ${index}`);
    await createPerformanceSnapshot({ contentId: baseline.id, source: 'manual', ageHours: 48, metrics: { reads: 1000, saves: 30 } });
  }
  const result = await generateRetrospective(current.id);
  await dismissInsight(result.insight.insightId);
  await assert.rejects(() => approveInsight(result.insight.insightId), (error) => error.code === 'INSIGHT_DISMISSED');
  assert.equal((await listLearningRules()).length, 0);
});

test('PR-04 删除回执时只级联清理与它绑定的表现链', async () => {
  const current = await content('回执删除内容');
  const receipt = { receiptId: 'rcpt_delete_contract', contentId: current.id, contentRevision: 1, platform: 'xiaohongshu', submittedAt: '2026-08-16T08:00:00.000Z', verified: true, status: 'delivered' };
  await putEntity('deliveryReceipts', receipt, 'receiptId');
  await createPerformanceSnapshot({ contentId: current.id, receiptId: receipt.receiptId, capturedAt: '2026-08-17T08:00:00.000Z', source: 'manual', metrics: { reads: 1000 } });
  await createPerformanceSnapshot({ contentId: current.id, ageHours: 24, capturedAt: '2026-08-17T09:00:00.000Z', source: 'manual', metrics: { reads: 1100 } });
  const removed = await deletePerformanceByReceipt(receipt.receiptId);
  assert.equal(removed.snapshots, 1);
  const remaining = await listContentPerformance(current.id);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].receiptId, null);
});

test('PR-04 删除内容时清理表现、复盘建议和对应学习规则', async () => {
  const current = await content('待删除内容');
  await createPerformanceSnapshot({ contentId: current.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 1000, saves: 80 } });
  for (let index = 0; index < 5; index += 1) {
    const baseline = await content(`删除测试基线 ${index}`);
    await createPerformanceSnapshot({ contentId: baseline.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 1000, saves: 30 } });
  }
  const retrospective = await generateRetrospective(current.id);
  await approveInsight(retrospective.insight.insightId);

  assert.equal((await listContentPerformance(current.id)).length, 1);
  assert.equal((await listLearningRules()).length, 1);
  await deleteContent(current.id);
  const removed = await deletePerformanceForContent(current.id);
  assert.deepEqual(removed, { snapshots: 1, insights: 1, learningRules: 1 });
  assert.equal((await listContentPerformance(current.id)).length, 0);
  assert.equal((await listLearningRules()).length, 0);
});

test('PR-04 用户单独删除表现快照时同步撤销其洞察和学习规则', async () => {
  const current = await content('单独删除表现');
  const snapshot = await createPerformanceSnapshot({ contentId: current.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 1000, saves: 90 } });
  for (let index = 0; index < 5; index += 1) {
    const baseline = await content(`单删基线 ${index}`);
    await createPerformanceSnapshot({ contentId: baseline.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 1000, saves: 30 } });
  }
  const retrospective = await generateRetrospective(current.id, snapshot.snapshotId);
  await approveInsight(retrospective.insight.insightId);
  const removed = await deletePerformanceSnapshot(snapshot.snapshotId);
  assert.deepEqual(removed, { snapshots: 1, insights: 1, learningRules: 1 });
  assert.equal((await listContentPerformance(current.id)).length, 0);
  assert.equal((await getStrategyContext({ platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing' })).length, 0);
});

test('PR-04 策略上下文不重复展示相同范围和内容的经验', async () => {
  const current = await content('当前内容');
  await createPerformanceSnapshot({ contentId: current.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 1000, saves: 90 } });
  for (let index = 0; index < 5; index += 1) {
    const baseline = await content(`基线 ${index}`);
    await createPerformanceSnapshot({ contentId: baseline.id, source: 'manual', platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing', ageHours: 48, metrics: { reads: 1000, saves: 30 } });
  }
  const first = await generateRetrospective(current.id);
  const firstRule = await approveInsight(first.insight.insightId);
  const second = await generateRetrospective(current.id);
  const secondRule = await approveInsight(second.insight.insightId);
  assert.notEqual(firstRule.ruleId, secondRule.ruleId);
  assert.equal((await getStrategyContext({ platform: 'xiaohongshu', goal: 'save', contentType: 'product_marketing' })).length, 1);
});
