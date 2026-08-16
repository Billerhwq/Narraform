import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskBrief, buildFactSet, classifyContentType } from '../server/task-understanding.js';
import { normalizeAndRepairResult, runQualityChecks, weightedTitleLength } from '../server/quality.js';
import { resolvePlatformSpec } from '../server/platform-specs.js';

const productMaterial = [{
  id: 'material_product',
  kind: 'text',
  displayName: '产品资料',
  text: 'Narraform 支持小红书、知乎、微信公众号和通用文案。系统会先抽取事实，再按平台规则生成内容。我认为文案首先要可信。我们实际测试过任务理解流程。',
}];

test('任务理解将事实、作者观点和真实经历分开保存', () => {
  const facts = buildFactSet({ instruction: '介绍 Narraform', materials: productMaterial });
  assert.ok(facts.verifiedFacts.length >= 2);
  assert.equal(facts.opinions.length, 1);
  assert.equal(facts.experiences.length, 1);
  assert.match(facts.opinions[0].statement, /我认为/);
  assert.match(facts.experiences[0].statement, /实际测试/);
});

test('完整请求返回 TaskBrief 和三套可追溯策略', () => {
  const { taskBrief } = createTaskBrief({
    instruction: '产品名是 Narraform。面向内容运营写一篇自然的小红书产品介绍，不要营销腔。',
    platform: 'xiaohongshu',
    materials: productMaterial,
  });
  assert.equal(taskBrief.status, 'awaiting_strategy');
  assert.equal(taskBrief.strategyOptions.length, 3);
  assert.ok(taskBrief.strategyOptions.every((strategy) => strategy.audience.origin === 'inferred'));
  assert.ok(taskBrief.strategyOptions.every((strategy) => Array.isArray(strategy.valueProposition.evidenceFactIds)));
});

test('模糊请求、明确要求无依据数据和无依据亲测都返回 needs_input', () => {
  for (const instruction of ['帮我宣传一下', '写增长 50% 的效果文案', '请用我的亲测经历来写']) {
    const { taskBrief } = createTaskBrief({ instruction, platform: 'xiaohongshu', materials: [] });
    assert.equal(taskBrief.status, 'needs_input');
    assert.ok(taskBrief.questions.length > 0 && taskBrief.questions.length <= 2);
  }
});

test('小红书产品有名称和基础能力就可生成，只有名称时才追问', () => {
  const sparse = createTaskBrief({
    instruction: '产品名是 Tlink。Tlink 是 AI 求职产品，支持自动投简历。请写一篇小红书产品介绍。',
    platform: 'xiaohongshu',
    materials: [],
  }).taskBrief;
  assert.equal(sparse.status, 'awaiting_strategy');

  const nameOnly = createTaskBrief({
    instruction: '产品名是 Tlink。请写一篇小红书产品介绍。',
    platform: 'xiaohongshu',
    materials: [],
  }).taskBrief;
  assert.equal(nameOnly.status, 'needs_input');
  assert.match(nameOnly.questions.join('\n'), /是什么或能做什么/);

  const enough = createTaskBrief({
    instruction: '产品名是 Tlink。Tlink 是 AI 求职产品，支持自动投简历。用户可以设置求职方向，产品面向希望扩大投递范围的求职者，投递前允许人工确认。请写一篇小红书产品介绍。',
    platform: 'xiaohongshu',
    materials: [],
  }).taskBrief;
  assert.equal(enough.status, 'awaiting_strategy');
});

test('禁止虚构效果的要求不会被误判为需要提供量化数据', () => {
  const { taskBrief } = createTaskBrief({
    instruction: '产品名是 CodeLoop。CodeLoop 是 AI 编码 Agent，支持读取代码仓库、修改代码并运行测试。请写产品宣传文案，不要虚构使用效果、节省比例或行业排名。',
    platform: 'xiaohongshu',
    materials: [],
  });
  assert.equal(taskBrief.status, 'awaiting_strategy');
  assert.deepEqual(taskBrief.constraints.unsupportedClaims, []);
});

test('产品描述中的操作字样不会把产品营销错分成教程', () => {
  assert.equal(classifyContentType('产品名是 Tlink，核心价值是减少手动重复投递操作，请写产品介绍'), 'product_marketing');
  assert.equal(classifyContentType('写一份 Tlink 的操作指南'), 'tutorial');
});

test('知乎回答必须有问题标题，知乎文章不要求问题标题', () => {
  const answer = createTaskBrief({ instruction: '介绍 Narraform 的内容生成能力', platform: 'zhihu', platformMode: 'answer', materials: productMaterial }).taskBrief;
  const article = createTaskBrief({ instruction: '写一篇介绍 Narraform 的知乎文章', platform: 'zhihu', platformMode: 'article', materials: productMaterial }).taskBrief;
  assert.equal(answer.status, 'needs_input');
  assert.match(answer.questions.join(''), /问题标题/);
  assert.equal(article.status, 'awaiting_strategy');
});

test('平台硬限制可自动修复且通用文案不继承平台格式', () => {
  const xhs = normalizeAndRepairResult({ titleCandidates: ['这是一个明显超过小红书标题加权长度硬上限的测试标题需要被裁剪'], summary: null, bodyMarkdown: '正文', topics: ['一', '二', '三'] }, resolvePlatformSpec('xiaohongshu'));
  assert.ok(xhs.titleCandidates.every((title) => weightedTitleLength(title) <= 38));

  const opening = '这是正文第一段，公众号摘要不应该逐字复制这一段。';
  const wechat = normalizeAndRepairResult({ titleCandidates: ['公众号内容测试'], summary: opening, bodyMarkdown: `${opening}\n\n## 正文\n更多内容。`, topics: ['不应保留'] }, resolvePlatformSpec('wechat'));
  assert.notEqual(wechat.summary, opening);
  assert.ok([...wechat.summary.replace(/\s/g, '')].length <= 128);
  assert.deepEqual(wechat.topics, []);

  const generic = normalizeAndRepairResult({ titleCandidates: ['平台标题'], summary: null, bodyMarkdown: '通用正文', topics: ['小红书话题'] }, resolvePlatformSpec('generic'));
  assert.deepEqual(generic.titleCandidates, []);
  assert.deepEqual(generic.topics, []);
});

test('小红书模型漏传话题时会根据已确认内容内部补齐', () => {
  const repaired = normalizeAndRepairResult({
    titleCandidates: ['Tlink 自动投递简历'],
    summary: null,
    bodyMarkdown: 'Tlink 是面向求职者的 AI 求职工具，可以按照方向投递简历。',
    topics: [],
  }, resolvePlatformSpec('xiaohongshu'), {
    taskBrief: { contentType: 'product_marketing', subject: { name: 'Tlink' }, facts: [] },
    factSet: { verifiedFacts: [] },
  });
  assert.ok(repaired.topics.length >= 3);
  assert.ok(repaired.topics.includes('Tlink'));
  assert.ok(repaired.topics.includes('AI求职'));
  assert.equal(repaired.topicsAutoCompleted, true);
});

test('无证据数字和虚构经历进入阻断状态', () => {
  const report = runQualityChecks({ titleCandidates: ['内容标题一', '内容标题二', '内容标题三'], summary: null, bodyMarkdown: '我亲测用了以后效率提升 50%。', topics: ['内容', '方法', '效率'] }, resolvePlatformSpec('xiaohongshu'), { verifiedFacts: [], experiences: [], conflicts: [], knownNumbers: [] });
  assert.equal(report.status, 'blocked');
  assert.equal(report.factCheck, 'fail');
  assert.match(report.blockingErrors.join('\n'), /50%|经历表达/);
});

test('第一人称及省略主语的经历变体仍会被阻断', () => {
  for (const bodyMarkdown of ['我最近试了一个工具，感觉效率更高。', '我们使用这个产品后发现流程更顺了。', '最近我在用 Narraform，感觉很方便。', '最近用了一个叫 Narraform 的 AI 文案助手。', '前段时间试了 Narraform，操作挺方便。']) {
    const report = runQualityChecks({ titleCandidates: ['标题一', '标题二', '标题三'], summary: null, bodyMarkdown, topics: ['内容', '方法', '工具'] }, resolvePlatformSpec('xiaohongshu'), { verifiedFacts: [], experiences: [], conflicts: [], knownNumbers: [] });
    assert.equal(report.status, 'blocked');
    assert.match(report.blockingErrors.join('\n'), /经历表达/);
  }
});
