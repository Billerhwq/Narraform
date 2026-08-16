import crypto from 'node:crypto';
import { getContent } from './store.js';
import { getDeliveryReceipt } from './publish-delivery.js';
import { deleteEntity, getEntity, listEntities, putEntity, updateEntity } from './roadmap-store.js';
import { runAdapterOperation } from './adapter-runtime.js';

function now() { return new Date().toISOString(); }
function performanceError(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; return error; }
function numberOrMissing(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined; }
function round(value, precision = 5) { return Number(value.toFixed(precision)); }
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const ALIASES = {
  impressions: 'exposures', exposure: 'exposures', exposures: 'exposures',
  views: 'reads', reads: 'reads', read: 'reads',
  likes: 'likes', upvotes: 'likes',
  favorites: 'saves', collects: 'saves', saves: 'saves',
  comments: 'comments', replies: 'comments',
  shares: 'shares', forwards: 'shares',
};
const METRIC_SOURCES = new Set(['platform_api', 'browser', 'manual']);
const DATA_QUALITIES = new Set(['complete', 'partial', 'unverified']);

function validatedAgeHours(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw performanceError('PERFORMANCE_AGE_INVALID', '发布后经过时间必须是大于或等于 0 的小时数');
  return round(numeric, 2);
}

function hoursBetween(start, end) {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    throw performanceError('PERFORMANCE_CAPTURE_TIME_INVALID', '表现数据的采集时间不能早于发布时间');
  }
  return round((endTime - startTime) / 3_600_000, 2);
}

export function normalizeMetrics(rawMetrics = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(rawMetrics)) {
    const target = ALIASES[key];
    const numeric = numberOrMissing(value);
    if (target && numeric !== undefined) normalized[target] = numeric;
  }
  const denominator = normalized.reads || normalized.exposures;
  if (denominator) {
    if (normalized.saves !== undefined) normalized.saveRate = { value: round(normalized.saves / denominator), formula: `saves / ${normalized.reads ? 'reads' : 'exposures'}` };
    if (normalized.likes !== undefined) normalized.likeRate = { value: round(normalized.likes / denominator), formula: `likes / ${normalized.reads ? 'reads' : 'exposures'}` };
    if (normalized.comments !== undefined) normalized.commentRate = { value: round(normalized.comments / denominator), formula: `comments / ${normalized.reads ? 'reads' : 'exposures'}` };
  }
  return normalized;
}

function resolveVersion(content, revision) {
  const targetRevision = Number(revision || content.revision || content.versions.length);
  return content.versions.find((item) => Number(item.revision) === targetRevision) || content.versions[targetRevision - 1] || null;
}

export async function createPerformanceSnapshot(input) {
  const content = await getContent(input.contentId);
  if (!content) throw performanceError('CONTENT_NOT_FOUND', '没有找到对应内容', 404);
  const version = resolveVersion(content, input.contentRevision);
  if (!version) throw performanceError('CONTENT_VERSION_NOT_FOUND', '没有找到对应内容版本', 404);
  let receipt = null;
  if (input.receiptId) {
    receipt = await getDeliveryReceipt(input.receiptId);
    if (!receipt) throw performanceError('DELIVERY_RECEIPT_NOT_FOUND', '没有找到发布回执', 404);
    if (receipt.contentId !== content.id || Number(receipt.contentRevision) !== Number(version.revision || input.contentRevision)) throw performanceError('PERFORMANCE_RECEIPT_MISMATCH', '发布回执与内容版本不一致', 409);
  }
  if (!METRIC_SOURCES.has(input.source)) throw performanceError('METRIC_SOURCE_UNSUPPORTED', '数据来源必须是平台接口、浏览器读取或手工录入');
  const capturedAt = input.capturedAt || now();
  const ageHours = receipt?.submittedAt
    ? hoursBetween(receipt.submittedAt, capturedAt)
    : validatedAgeHours(input.ageHours ?? 0);
  const dataQuality = input.dataQuality || 'complete';
  if (!DATA_QUALITIES.has(dataQuality)) throw performanceError('METRIC_DATA_QUALITY_UNSUPPORTED', '数据完整度只能是完整、部分或待核实');
  const duplicate = (await listEntities('performanceSnapshots')).find((item) => item.contentId === content.id
    && Number(item.contentRevision) === Number(version.revision || input.contentRevision)
    && (item.receiptId || null) === (receipt?.receiptId || null)
    && item.source === input.source
    && item.capturedAt === capturedAt);
  if (duplicate) return duplicate;
  const snapshot = {
    snapshotId: `perf_${crypto.randomUUID()}`,
    contentId: content.id,
    contentRevision: Number(version.revision || input.contentRevision || content.versions.length),
    receiptId: receipt?.receiptId || null,
    receiptVerified: receipt ? Boolean(receipt.verified) : false,
    publicationLinkStatus: receipt ? (receipt.verified ? 'verified' : 'pending') : 'unlinked',
    platform: input.platform || receipt?.platform || version.platform || content.platform,
    goal: input.goal || version.strategySnapshot?.goal || 'awareness',
    contentType: input.contentType || version.strategySnapshot?.contentType || 'general_article',
    capturedAt,
    ageHours,
    source: input.source,
    rawMetrics: structuredClone(input.rawMetrics || input.metrics || {}),
    normalizedMetrics: normalizeMetrics(input.rawMetrics || input.metrics || {}),
    dataQuality,
    createdAt: now(),
  };
  await putEntity('performanceSnapshots', snapshot, 'snapshotId');
  return snapshot;
}

async function defaultMetricConnector(input) {
  const endpoint = process.env.NARRAFORM_METRIC_ADAPTER_URL;
  const key = process.env.NARRAFORM_METRIC_ADAPTER_KEY;
  if (!endpoint) throw performanceError('METRIC_CONNECTOR_REQUIRED', '尚未配置平台数据连接器，可以先手工补充表现', 503);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw performanceError('METRIC_CONNECTOR_FAILED', `平台数据连接器返回 ${response.status}，可以先手工补充表现`, 502);
  return response.json();
}

export async function syncPerformanceSnapshot(input, { connector = defaultMetricConnector } = {}) {
  const payload = await runAdapterOperation({
    adapterKey: `metrics:${input.platform || 'unknown'}`,
    adapterVersion: process.env.NARRAFORM_METRIC_ADAPTER_VERSION || 'external-unknown',
    action: 'sync_metrics',
    operationId: input.receiptId || input.contentId,
    execute: () => connector(input),
  });
  if (!payload || typeof payload.metrics !== 'object') throw performanceError('METRIC_CONNECTOR_INVALID', '平台数据连接器没有返回有效指标', 502);
  const source = payload.source === 'browser' ? 'browser' : 'platform_api';
  return createPerformanceSnapshot({
    ...input,
    ...payload,
    source,
    rawMetrics: payload.rawMetrics || payload.metrics,
    dataQuality: payload.dataQuality || 'partial',
  });
}

export async function listContentPerformance(contentId) {
  return (await listEntities('performanceSnapshots')).filter((item) => item.contentId === contentId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

function comparableSnapshots(current, all) {
  return all.filter((item) => item.snapshotId !== current.snapshotId
    && item.platform === current.platform
    && item.goal === current.goal
    && item.contentType === current.contentType
    && Math.abs(Number(item.ageHours || 0) - Number(current.ageHours || 0)) <= 24
    && Math.abs(new Date(current.capturedAt) - new Date(item.capturedAt)) <= 90 * 24 * 60 * 60 * 1000);
}

function metricValue(snapshot, key) {
  const value = snapshot.normalizedMetrics?.[key];
  return typeof value === 'object' ? value.value : value;
}

function chooseMetric(snapshot) {
  if (snapshot.platform === 'xiaohongshu' && metricValue(snapshot, 'saveRate') !== undefined) return { key: 'saveRate', label: '收藏率' };
  if (metricValue(snapshot, 'commentRate') !== undefined) return { key: 'commentRate', label: '评论率' };
  if (metricValue(snapshot, 'likeRate') !== undefined) return { key: 'likeRate', label: '互动率' };
  if (metricValue(snapshot, 'reads') !== undefined) return { key: 'reads', label: '阅读量' };
  return null;
}

function percent(value) { return `${round(value * 100, 2).toFixed(2)}%`; }

export async function generateRetrospective(contentId, snapshotId = null) {
  const snapshots = await listContentPerformance(contentId);
  const current = snapshotId ? snapshots.find((item) => item.snapshotId === snapshotId) : snapshots[0];
  if (!current) throw performanceError('PERFORMANCE_SNAPSHOT_NOT_FOUND', '还没有这篇内容的表现数据', 404);
  const all = await listEntities('performanceSnapshots');
  const comparable = comparableSnapshots(current, all);
  const metric = chooseMetric(current);
  if (!metric || comparable.length < 5) {
    return { snapshot: current, baseline: { status: 'insufficient', sampleSize: comparable.length, minimumSampleSize: 5 }, insight: null };
  }
  const values = comparable.map((item) => metricValue(item, metric.key)).filter((value) => typeof value === 'number');
  if (values.length < 5) return { snapshot: current, baseline: { status: 'insufficient', sampleSize: values.length, minimumSampleSize: 5 }, insight: null };
  const currentValue = metricValue(current, metric.key);
  const medianValue = median(values);
  const ratio = medianValue ? currentValue / medianValue : 1;
  const direction = ratio >= 1.15 ? '高于' : ratio <= 0.85 ? '低于' : '接近';
  const valueText = metric.key.endsWith('Rate') ? percent(currentValue) : String(Math.round(currentValue));
  const medianText = metric.key.endsWith('Rate') ? percent(medianValue) : String(Math.round(medianValue));
  const hypothesis = metric.key === 'saveRate'
    ? '正文中可复用的步骤或工作流结构，可能让读者更愿意保存内容'
    : metric.key === 'commentRate'
      ? '明确且容易回答的互动问题，可能提升了讨论意愿'
      : '当前表达角度可能更贴近这类读者的关注点';
  const recommendation = direction === '高于'
    ? `下一篇同类内容继续保留当前${metric.label}相关结构，同时更换标题角度再验证一次`
    : direction === '低于'
      ? `下一篇同类内容调整开头和核心信息顺序，并保留其他变量用于比较`
      : `当前${metric.label}接近常态，下一篇只调整一个内容变量进行验证`;
  const insight = {
    insightId: `ins_${crypto.randomUUID()}`,
    contentId,
    snapshotId: current.snapshotId,
    observation: `这篇内容的${metric.label}${direction}同目标内容中位数`,
    evidence: [`当前 ${valueText}`, `中位数 ${medianText}`, `同类样本 ${values.length} 条`],
    hypothesis,
    recommendation,
    scope: { platform: current.platform, goal: current.goal, contentType: current.contentType },
    confidence: values.length >= 20 ? 'high' : 'medium',
    causalClaim: false,
    status: 'proposed',
    createdAt: now(),
  };
  await putEntity('retrospectiveInsights', insight, 'insightId');
  return { snapshot: current, baseline: { status: 'available', sampleSize: values.length, windowDays: 90, metric: metric.key, median: round(medianValue), current: currentValue }, insight };
}

export async function approveInsight(insightId) {
  const insight = await getEntity('retrospectiveInsights', insightId, 'insightId');
  if (!insight) throw performanceError('INSIGHT_NOT_FOUND', '没有找到这条复盘建议', 404);
  if (insight.status === 'dismissed') throw performanceError('INSIGHT_DISMISSED', '这条复盘建议已忽略，不能再用于后续创作', 409);
  const existing = (await listEntities('learningRules')).find((item) => item.sourceInsightId === insightId);
  if (existing) return existing;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const rule = {
    ruleId: `lr_${crypto.randomUUID()}`,
    sourceInsightId: insightId,
    rule: insight.recommendation,
    appliesWhen: insight.scope,
    priority: 'suggestion',
    expiresAt,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
  };
  await putEntity('learningRules', rule, 'ruleId');
  await updateEntity('retrospectiveInsights', insightId, { ...insight, status: 'approved', approvedAt: now() }, 'insightId');
  return rule;
}

export async function dismissInsight(insightId) {
  const insight = await updateEntity('retrospectiveInsights', insightId, (current) => ({ ...current, status: 'dismissed', dismissedAt: now() }), 'insightId');
  if (!insight) throw performanceError('INSIGHT_NOT_FOUND', '没有找到这条复盘建议', 404);
  return insight;
}

export async function updateLearningRule(ruleId, patch) {
  const rule = await updateEntity('learningRules', ruleId, (current) => ({
    ...current,
    ...(patch.rule?.trim() ? { rule: patch.rule.trim() } : {}),
    ...(['active', 'inactive'].includes(patch.status) ? { status: patch.status } : {}),
    updatedAt: now(),
  }), 'ruleId');
  if (!rule) throw performanceError('LEARNING_RULE_NOT_FOUND', '没有找到这条创作经验', 404);
  return rule;
}

export async function getStrategyContext({ platform, goal, contentType }) {
  const currentTime = Date.now();
  const matches = (await listEntities('learningRules')).filter((rule) => rule.status === 'active'
    && new Date(rule.expiresAt).getTime() > currentTime
    && (!platform || rule.appliesWhen.platform === platform)
    && (!goal || rule.appliesWhen.goal === goal)
    && (!contentType || rule.appliesWhen.contentType === contentType));
  const seen = new Set();
  return matches.filter((rule) => {
    const key = JSON.stringify([rule.rule, rule.appliesWhen?.platform, rule.appliesWhen?.goal, rule.appliesWhen?.contentType]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function listLearningRules() { return listEntities('learningRules'); }

async function deletePerformanceRecords(snapshots, insights) {
  const insightIds = new Set(insights.map((item) => item.insightId));
  const rules = (await listEntities('learningRules')).filter((item) => insightIds.has(item.sourceInsightId));
  await Promise.all([
    ...snapshots.map((item) => deleteEntity('performanceSnapshots', item.snapshotId, 'snapshotId')),
    ...insights.map((item) => deleteEntity('retrospectiveInsights', item.insightId, 'insightId')),
    ...rules.map((item) => deleteEntity('learningRules', item.ruleId, 'ruleId')),
  ]);
  return { snapshots: snapshots.length, insights: insights.length, learningRules: rules.length };
}

export async function deletePerformanceSnapshot(snapshotId) {
  const snapshot = await getEntity('performanceSnapshots', snapshotId, 'snapshotId');
  if (!snapshot) return null;
  const insights = (await listEntities('retrospectiveInsights')).filter((item) => item.snapshotId === snapshotId);
  return deletePerformanceRecords([snapshot], insights);
}

export async function deletePerformanceByReceipt(receiptId) {
  const snapshots = (await listEntities('performanceSnapshots')).filter((item) => item.receiptId === receiptId);
  const snapshotIds = new Set(snapshots.map((item) => item.snapshotId));
  const insights = (await listEntities('retrospectiveInsights')).filter((item) => snapshotIds.has(item.snapshotId));
  return deletePerformanceRecords(snapshots, insights);
}

export async function deletePerformanceForContent(contentId) {
  const snapshots = (await listEntities('performanceSnapshots')).filter((item) => item.contentId === contentId);
  const insights = (await listEntities('retrospectiveInsights')).filter((item) => item.contentId === contentId);
  return deletePerformanceRecords(snapshots, insights);
}
