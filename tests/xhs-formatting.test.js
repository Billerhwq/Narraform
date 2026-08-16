import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGenerationPrompt } from '../server/content-engine.js';
import { executeContentOperation } from '../server/operation-engine.js';
import { getOperationSpec } from '../server/operation-specs.js';
import { PLATFORM_SPECS } from '../server/platform-specs.js';
import { enforceProductFactLanguage, normalizeAndRepairResult, repairXhsBodyFormatting, runQualityChecks } from '../server/quality.js';
import { resolveXhsFormattingProfile } from '../server/xhs-formatting.js';

function task(contentType = 'product_marketing', facts = ['产品名是 CodePilot。', 'CodePilot 支持根据仓库上下文生成代码修改建议。']) {
  return {
    taskId: 'task-xhs-v4',
    instruction: '为 CodePilot 写一篇小红书产品宣传文案',
    platform: 'xiaohongshu',
    tone: '自然专业',
    contentType,
    subject: { name: 'CodePilot', description: facts[0] },
    facts: facts.map((statement, index) => ({ factId: `fact_${index + 1}`, statement })),
    experiences: [], opinions: [], constraints: {},
  };
}

const strategy = {
  id: 'strategy-xhs-v4', authorRole: '产品团队', goal: '帮助理解并判断是否试用',
  hook: '从具体任务场景进入', ctaIntent: 'invite_trial',
  audience: { label: '需要理解代码仓库上下文的开发者' },
};

test('XHS v4 根据内容、风险和用户覆盖稳定解析 FormattingProfile', () => {
  const sparse = resolveXhsFormattingProfile({ taskBrief: task(), strategy });
  assert.equal(sparse.platformFeel, 'natural');
  assert.equal(sparse.contentPattern, 'scenario_value');
  assert.deepEqual(sparse.lengthTarget, { bodyMin: 180, bodyMax: 350 });
  assert.deepEqual([sparse.emojiPolicy.recommendedMin, sparse.emojiPolicy.maxCount], [1, 3]);

  const richProduct = resolveXhsFormattingProfile({ taskBrief: task('product_marketing', Array.from({ length: 7 }, (_, index) => `产品事实 ${index + 1}。`)), strategy });
  assert.deepEqual([richProduct.emojiPolicy.recommendedMin, richProduct.emojiPolicy.maxCount], [2, 3]);

  const tutorial = resolveXhsFormattingProfile({ taskBrief: task('tutorial', Array.from({ length: 4 }, (_, index) => `教程事实 ${index + 1}。`)), strategy, userOverride: { platformFeel: 'active' } });
  assert.equal(tutorial.platformFeel, 'active');
  assert.equal(tutorial.contentPattern, 'task_steps');
  assert.equal(tutorial.emojiPolicy.maxCount, 5);
  assert.deepEqual(tutorial.lengthTarget, { bodyMin: 300, bodyMax: 600 });

  const noEmoji = resolveXhsFormattingProfile({ taskBrief: task(), strategy, userOverride: { platformFeel: 'active', emoji: 'none' } });
  assert.equal(noEmoji.emojiPolicy.maxCount, 0);
});

test('XHS v4 生成合同包含已解析规则而不是模糊的适量表达', () => {
  const taskBrief = task();
  const formattingProfile = resolveXhsFormattingProfile({ taskBrief, strategy });
  const prompt = buildGenerationPrompt({
    instruction: taskBrief.instruction,
    tone: taskBrief.tone,
    factSet: { verifiedFacts: taskBrief.facts, opinions: [], experiences: [] },
    taskBrief,
    strategy,
    spec: PLATFORM_SPECS.xiaohongshu,
    formattingProfile,
  });
  assert.match(prompt, /小红书运行时排版合同/);
  assert.match(prompt, /正文使用 1-3 个/);
  assert.match(prompt, /连续文本块不超过 120 字/);
  assert.match(prompt, /正文目标 180-350/);
  assert.doesNotMatch(prompt, /必须写到 320-600/);
});

test('XHS v4 生成交付前自动拆分长段并补充语义 Emoji 锚点', () => {
  const taskBrief = task();
  const profile = resolveXhsFormattingProfile({ taskBrief, strategy });
  const body = '如果你正在改一个已有代码库，真正费时的往往是反复解释上下文。\nCodePilot 会读取当前仓库信息，给出具体的修改建议。\n它适合想保留关键代码确认权的开发者，但不能代替代码审查。';
  const repaired = repairXhsBodyFormatting(body, profile);
  assert.match(repaired, /\n\n/);
  assert.match(repaired, /[\p{Extended_Pictographic}]/u);
  const report = runQualityChecks({
    titleCandidates: ['CodePilot 先理解仓库上下文', '写代码前先看项目边界', '开发者怎样减少重复说明'],
    bodyMarkdown: repaired, topics: ['AI开发', '代码工具', 'CodePilot'],
    formattingOverride: { platformFeel: 'auto', emoji: 'auto' }, strategySnapshot: strategy,
  }, PLATFORM_SPECS.xiaohongshu, { verifiedFacts: taskBrief.facts, knownNumbers: [], conflicts: [] }, { taskBrief, strategy, formattingProfile: profile });
  assert.equal(report.formattingChecks.emojiCount, 'pass');
  assert.equal(report.formattingChecks.paragraphScanability, 'pass');
});

test('XHS v4 用户明确不要 Emoji 时不自动添加', () => {
  const profile = resolveXhsFormattingProfile({ taskBrief: task(), strategy, userOverride: { platformFeel: 'natural', emoji: 'none' } });
  const repaired = repairXhsBodyFormatting('CodePilot 支持根据仓库上下文生成代码修改建议。', profile);
  assert.doesNotMatch(repaired, /[\p{Extended_Pictographic}]/u);
});

test('XHS v4 事实安全清理不会把短段重新压成单换行', () => {
  const taskBrief = task();
  const cleaned = enforceProductFactLanguage({
    titleCandidates: ['CodePilot 先理解仓库上下文', '写代码前先看项目边界', '开发者怎样减少重复说明'],
    bodyMarkdown: '💡 CodePilot 支持根据仓库上下文生成代码修改建议。\n\n使用前需要登录。\n\n关键改动仍然需要用户确认。',
    topics: ['AI开发', '代码工具', 'CodePilot'],
  }, PLATFORM_SPECS.xiaohongshu, { verifiedFacts: taskBrief.facts }, 'product_marketing');
  assert.match(cleaned.bodyMarkdown, /💡[^\n]+\n\n关键改动/);
  assert.doesNotMatch(cleaned.bodyMarkdown, /登录/);
});

test('XHS v4 质量检查按当前 Profile 检查 Emoji、段落和 Markdown 排版', () => {
  const taskBrief = task('general_article', Array.from({ length: 3 }, (_, index) => `内容事实 ${index + 1}。`));
  const formattingProfile = resolveXhsFormattingProfile({ taskBrief, strategy, userOverride: { platformFeel: 'restrained' } });
  const result = {
    titleCandidates: ['CodePilot 如何理解仓库', '代码修改前先看上下文', '开发者怎样减少重复说明'],
    bodyMarkdown: `## 使用方式\n\n${'这一段包含很多连续信息，用来模拟手机上难以扫读的大段正文。'.repeat(7)}\n\n✨🔥😍 连续表情不承担信息作用。`,
    topics: ['AI开发', 'AI编程', '人工智能编程'],
    formattingOverride: { platformFeel: 'restrained', emoji: 'auto' },
    strategySnapshot: { ...strategy, contentType: 'general_article' },
  };
  const report = runQualityChecks(result, PLATFORM_SPECS.xiaohongshu, { verifiedFacts: taskBrief.facts, knownNumbers: [], conflicts: [] }, { taskBrief, strategy, formattingProfile });
  assert.equal(report.formattingChecks.emojiCount, 'warning');
  assert.equal(report.formattingChecks.paragraphScanability, 'warning');
  assert.equal(report.formattingChecks.markdownLayout, 'warning');
  assert.match(report.warnings.join('\n'), /Emoji|Markdown|过长段落/);
});

test('用户删除的小红书话题不会被质量修复自动加回', () => {
  const taskBrief = task();
  const repaired = normalizeAndRepairResult({
    titleCandidates: ['CodePilot 先看仓库上下文', '写代码前先说明什么', '开发者怎样使用 CodePilot'],
    bodyMarkdown: '如果你正在维护一个已有代码仓库，可以先确认工具是否理解当前上下文。\n\nCodePilot 支持根据仓库上下文生成代码修改建议。\n\n你可以结合自己的项目判断是否适合。',
    topics: ['AI开发'],
    removedTopics: ['产品介绍', '实用工具'],
    strategySnapshot: { ...strategy, contentType: 'product_marketing' },
  }, PLATFORM_SPECS.xiaohongshu, { taskBrief, factSet: { verifiedFacts: taskBrief.facts }, removedTopics: ['产品介绍', '实用工具'] });
  assert.deepEqual(repaired.topics, ['AI开发']);
  assert.deepEqual(repaired.removedTopics.sort(), ['产品介绍', '实用工具'].sort());
  assert.doesNotMatch(repaired.topics.join('\n'), /产品介绍|实用工具/);
});

test('只有小红书换正文可以同步更新话题和评论问题', () => {
  const xhs = getOperationSpec('regenerate_body', [], 'xiaohongshu');
  const generic = getOperationSpec('regenerate_body', [], 'generic');
  assert.deepEqual(xhs.writableFields, ['bodyMarkdown', 'topics', 'commentPrompt']);
  assert.deepEqual(generic.writableFields, ['bodyMarkdown']);
});

test('小红书换正文保留选中标题与平台感，同时更新正文话题和评论问题', async () => {
  const taskBrief = { ...task(), strategyOptions: [strategy], selectedStrategyId: strategy.id, platformMode: null };
  const currentResult = {
    resultId: 'result-xhs-parent', platform: 'xiaohongshu', platformMode: null,
    titleCandidates: ['CodePilot 先理解仓库上下文', '写代码前先看项目边界', '开发者怎样减少重复说明'],
    selectedTitleIndex: 0, summary: null,
    bodyMarkdown: '如果你正在维护已有仓库，先确认工具能否理解项目上下文。\n\nCodePilot 支持根据仓库上下文生成代码修改建议。\n\n可以结合当前项目判断是否适合。',
    topics: ['AI开发', '代码工具', '产品介绍'], commentPrompt: '你现在怎样补充项目上下文？',
    formatting: { platformFeel: 'restrained', label: '克制清楚' },
    formattingOverride: { platformFeel: 'restrained', emoji: 'auto' },
    removedTopics: ['实用工具'], strategySnapshot: { ...strategy, contentType: 'product_marketing' },
    taskId: taskBrief.taskId, strategyId: strategy.id,
  };
  const output = await executeContentOperation({
    operation: 'regenerate_body', platform: 'xiaohongshu', currentResult,
    parentResultId: currentResult.resultId, baseInstruction: taskBrief.instruction,
  }, {
    taskBrief,
    candidateGenerator: async () => ({
      ...currentResult,
      titleCandidates: ['不应覆盖的标题'],
      bodyMarkdown: '维护已有代码仓库时，项目上下文会直接影响修改建议。\n\nCodePilot 根据仓库上下文生成代码修改建议。\n\n如果你的任务需要在现有仓库中继续修改，可以据此判断。',
      topics: ['AI开发', '代码仓库', '开发者工具'],
      commentPrompt: '你最希望工具先理解仓库里的哪部分信息？',
    }),
  });
  assert.deepEqual(output.result.titleCandidates, currentResult.titleCandidates);
  assert.deepEqual(output.result.topics, ['AI开发', '代码仓库', '开发者工具']);
  assert.match(output.result.commentPrompt, /哪部分信息/);
  assert.equal(output.result.formatting.label, '克制清楚');
  assert.equal(output.result.formattingProfile, undefined);
  assert.deepEqual(output.result.removedTopics, ['实用工具']);
});
