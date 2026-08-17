import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerationPrompt } from '../server/content-engine.js';
import { resolvePlatformSpec } from '../server/platform-specs.js';
import { applyLearningRules } from '../server/strategy-engine.js';
import { createTaskBrief } from '../server/task-understanding.js';

test('PR-04 只有本次启用的学习规则进入策略和生成合同', () => {
  const { taskBrief, factSet } = createTaskBrief({
    instruction: '产品名是 CodeLoop，它可以读取授权仓库并运行测试。写给独立开发者的小红书产品介绍。',
    platform: 'xiaohongshu',
  });
  const learningRule = {
    ruleId: 'lr_workflow',
    sourceInsightId: 'ins_workflow',
    rule: '优先使用问题、流程、边界的正文结构',
    appliesWhen: { platform: 'xiaohongshu', contentType: 'product_marketing' },
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const enabled = applyLearningRules(taskBrief, [learningRule]);
  const enabledPrompt = buildGenerationPrompt({
    instruction: enabled.instruction,
    taskBrief: enabled,
    factSet,
    strategy: enabled.strategyOptions[0],
    spec: resolvePlatformSpec('xiaohongshu'),
  });
  assert.deepEqual(enabled.strategyOptions[0].learningRuleIds, ['lr_workflow']);
  assert.match(enabledPrompt, /优先使用问题、流程、边界的正文结构/);

  const disabled = applyLearningRules(taskBrief, [learningRule], ['lr_workflow']);
  const disabledPrompt = buildGenerationPrompt({
    instruction: disabled.instruction,
    taskBrief: disabled,
    factSet,
    strategy: disabled.strategyOptions[0],
    spec: resolvePlatformSpec('xiaohongshu'),
  });
  assert.deepEqual(disabled.learningRulesApplied, []);
  assert.deepEqual(disabled.strategyOptions[0].learningRuleIds, []);
  assert.doesNotMatch(disabledPrompt, /优先使用问题、流程、边界的正文结构/);
});
