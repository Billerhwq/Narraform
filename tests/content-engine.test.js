import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRequest, buildFactSet, generateCopy, modifyCopy } from '../server/content-engine.js';
import { PLATFORM_SPECS } from '../server/platform-specs.js';
import { enforceProductFactLanguage, makeNatural, runQualityChecks, stripSourceLeaks } from '../server/quality.js';

process.env.CONTENTFLOW_MODEL_MODE = 'local';

const baseMaterials = [{ id: 'source_1', kind: 'file', displayName: 'README.md', text: 'Open Mercato 支持多租户、RBAC 和工作流。关键写入动作需要人工确认。它适合复杂业务系统的研发团队。' }];
const prompts = [
  '根据资料写产品介绍', '写一篇面向技术负责人的产品介绍', '解释这个产品解决什么问题', '写得自然一点，不要营销感',
  '从工程边界角度介绍产品', '说明产品适合哪些团队', '写一篇功能更新介绍', '整理成用户能看懂的内容',
  '不要罗列功能，要解释价值', '写一篇专业但不官话的介绍', '从实际研发问题切入', '强调权限和人工确认',
  '写成观点内容', '写成一个教程型介绍', '写一篇活动推广文案', '写一份产品简介',
  '面向第一次了解产品的人', '面向已经使用 AI 编程的团队', '说明产品能力和限制', '不要虚构用户案例',
  '不要用第一人称体验', '写得简洁直接', '写得有观点', '写得轻松但专业',
  '换一个问题式开头', '从风险角度切入', '从长期维护角度切入', '从权限治理角度切入',
  '解释为什么不能只靠临场生成', '强调真实事实，不要空话',
];

for (const platform of Object.keys(PLATFORM_SPECS)) {
  test(`${platform}: 30 个生成用例返回统一结构并隔离来源`, async (t) => {
    for (const instruction of prompts) {
      await t.test(instruction, async () => {
        const factSet = buildFactSet({ instruction, materials: baseMaterials });
        const output = await generateCopy({ instruction, platform, tone: '自然、专业', materials: baseMaterials, factSet });
        assert.equal(output.status, 'completed');
        assert.equal(output.result.platform, platform);
        assert.ok(output.result.bodyMarkdown.length > 30);
        assert.equal(output.result.specVersion, PLATFORM_SPECS[platform].version);
        assert.equal(output.result.qualityReport.sourceLeakCheck, 'pass');
        const externalCopy = JSON.stringify({ titles: output.result.titleCandidates, summary: output.result.summary, body: output.result.bodyMarkdown, topics: output.result.topics });
        assert.doesNotMatch(externalCopy, /README|根据.*(?:资料|文档|文件)|文件路径/i);
        if (platform === 'xiaohongshu') assert.equal(output.result.titleCandidates.length, 3);
        if (platform === 'wechat') assert.ok(output.result.summary);
        if (platform === 'zhihu') assert.match(output.result.bodyMarkdown, /边界|限制|适用/);
      });
    }
  });
}

const leakInputs = [
  'README', 'README.md', '根据你提供的资料', '根据您上传的文件', '根据资料', '资料显示', '文档显示', '文件显示', '文档中写道', '文件中写道',
  '本地路径', '文件路径', 'C:\\Users\\test\\README.md', 'D:\\docs\\product.txt', '根据提供的文档', '根据上传的资料', '资料提到', '文档提到', 'README 深度解读', '来自文件路径',
  '基于你提供的资料', '基于您上传的内容', '你提供的资料', '您上传的文档',
];
test('来源泄露表达被清理', () => {
  for (const input of leakInputs) {
    const cleaned = stripSourceLeaks(`${input} 产品支持工作流。`);
    assert.doesNotMatch(cleaned, /README|(?:根据|基于).*(?:资料|文档|文件|内容)|(?:你|您)(?:提供|上传)的(?:资料|文档|文件|内容)|(?:资料|文档|文件)(?:显示|提到|中写道)|[A-Z]:\\/i);
  }
});

test('标题、摘要、正文和话题都执行来源隔离', async () => {
  const output = await generateCopy({ instruction: '根据资料写产品介绍', platform: 'xiaohongshu', tone: '自然、专业', materials: baseMaterials, factSet: buildFactSet({ instruction: '根据资料写产品介绍', materials: baseMaterials }) });
  const exposed = JSON.stringify([output.result.titleCandidates, output.result.summary, output.result.bodyMarkdown, output.result.topics]);
  assert.doesNotMatch(exposed, /README|(?:根据|基于).*(?:资料|文档|文件|内容)|(?:你|您)(?:提供|上传)的/i);
});

const aiPhrases = [
  '在当今快速发展的时代', '随着科技的不断发展', '值得一提的是', '从某种意义上来说', '总而言之，让我们', '这不仅是一款产品，更是一场革命',
  '未来已来', '让我们拭目以待', '共创美好未来', '赋能千行百业', '打造全新生态闭环', '首先，说明问题', '其次，说明做法', '此外，说明边界', '最后，做出总结',
  '赋能团队', '打造平台', '生态闭环', '首先说明', '其次说明', '此外说明', '最后说明', '在当今快速发展的时代，产品不断变化', '未来已来，共创美好未来',
  '值得一提的是，这很重要', '从某种意义上来说，这是一种方法', '总而言之，让我们行动', '打造全新生态闭环并赋能团队', '首先，其次，此外，最后', '随着科技的不断发展，未来已来',
];
test('30 个 AI 套话反例可以自然化', () => {
  for (const phrase of aiPhrases) {
    const output = makeNatural(`${phrase}。产品支持明确的权限规则。`);
    assert.ok(output.includes('产品支持明确的权限规则'));
    assert.doesNotMatch(output, /在当今快速发展的时代|随着科技的不断发展|值得一提的是|未来已来|共创美好未来|生态闭环/);
  }
});

test('自然化使用语义替换，不会把不妨考虑处理成病句', () => {
  const output = makeNatural('如果你有相关需求，不妨考虑 Tlink 是否适合。');
  assert.equal(output, '如果你有相关需求，可以判断 Tlink 是否适合。');
  assert.doesNotMatch(output, /，\s*Tlink/);
});

const vagueInputs = Array.from({ length: 20 }, (_, index) => index % 4 === 0 ? '帮我宣传一下' : index % 4 === 1 ? '写文案' : index % 4 === 2 ? '帮我介绍一下' : '帮我推广一下');
test('20 个信息不足用例会追问而不是编造', () => {
  for (const instruction of vagueInputs) {
    const factSet = buildFactSet({ instruction, materials: [] });
    const assessment = assessRequest({ instruction, factSet });
    assert.equal(assessment.enough, false);
    assert.ok(assessment.questions.length > 0 && assessment.questions.length <= 2);
  }
});

test('否定第一人称要求不会触发无关追问', () => {
  const factSet = buildFactSet({ instruction: '不要用第一人称体验', materials: baseMaterials });
  assert.equal(assessRequest({ instruction: '不要用第一人称体验', factSet }).enough, true);
  assert.equal(assessRequest({ instruction: '请用我的亲测经历来写', factSet: buildFactSet({ instruction: '请用我的亲测经历来写', materials: [] }) }).enough, false);
});

test('快捷修改保持来源隔离并创建新结果', async () => {
  const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
  const generated = await generateCopy({ instruction: '写产品介绍', platform: 'xiaohongshu', tone: '自然、专业', factSet, materials: baseMaterials });
  const natural = await modifyCopy({ instruction: '写产品介绍', modification: '更自然一点', platform: 'xiaohongshu', currentCopy: `在当今快速发展的时代，${generated.result.bodyMarkdown}`, factSet });
  assert.notEqual(natural.result.resultId, generated.result.resultId);
  assert.doesNotMatch(natural.result.bodyMarkdown, /在当今快速发展的时代|README/i);
});

test('换一批标题保留正文、摘要和话题', async () => {
  const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
  const generated = await generateCopy({ instruction: '写产品介绍', platform: 'xiaohongshu', tone: '自然、专业', factSet, materials: baseMaterials });
  const refreshed = await modifyCopy({
    instruction: '写产品介绍',
    modification: '换一批标题，只修改标题候选，正文保持不变',
    platform: 'xiaohongshu',
    currentCopy: generated.result.bodyMarkdown,
    summary: generated.result.summary,
    topics: generated.result.topics,
    factSet,
  });
  assert.equal(refreshed.result.bodyMarkdown, generated.result.bodyMarkdown);
  assert.deepEqual(refreshed.result.topics, generated.result.topics);
  assert.notDeepEqual(refreshed.result.titleCandidates, generated.result.titleCandidates);
});

test('换一批标题的生成合同以当前正文为准', async () => {
  const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
  let receivedPrompt = '';
  const currentBody = '当前正文只讨论多租户权限和关键写入人工确认。';
  const output = await modifyCopy({
    instruction: '写产品介绍', modification: '换一批标题，只修改标题候选', platform: 'xiaohongshu',
    currentCopy: currentBody, titleCandidates: ['旧标题一', '旧标题二'], summary: null, topics: ['权限治理'], factSet,
  }, { deepSeekClient: async (prompt) => { receivedPrompt = prompt; return { titleCandidates: ['权限边界先看这里', '关键写入为什么要确认', '多租户系统怎样控权限'], summary: null, bodyMarkdown: currentBody, topics: ['权限治理'] }; } });
  assert.equal(output.result.bodyMarkdown, currentBody);
  assert.match(receivedPrompt, /每个标题都必须准确概括当前正文/);
  assert.match(receivedPrompt, /当前正文只讨论多租户权限和关键写入人工确认/);
});

test('换一批正文围绕当前标题且保留标题、摘要和话题', async () => {
  const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
  const titleCandidates = ['标题一', '标题二', '标题三'];
  let receivedPrompt = '';
  const refreshed = await modifyCopy({
    instruction: '写产品介绍',
    modification: '换一批正文，只重写正文并跟随当前选中的标题',
    platform: 'xiaohongshu',
    currentCopy: '旧正文',
    titleCandidates,
    selectedTitleIndex: 1,
    summary: '保留摘要',
    topics: ['保留话题'],
    factSet,
  }, {
    deepSeekClient: async (prompt) => {
      receivedPrompt = prompt;
      return { titleCandidates: ['不应采用的新标题'], summary: '不应采用的新摘要', bodyMarkdown: '这是围绕当前标题重写的新正文。', topics: ['不应采用的新话题'] };
    },
  });
  assert.deepEqual(refreshed.result.titleCandidates, titleCandidates);
  assert.equal(refreshed.result.selectedTitleIndex, 1);
  assert.equal(refreshed.result.summary, '保留摘要');
  assert.deepEqual(refreshed.result.topics, ['保留话题']);
  assert.equal(refreshed.result.bodyMarkdown, '这是围绕当前标题重写的新正文。');
  assert.match(receivedPrompt, /当前选中标题“标题二”/);
  assert.match(receivedPrompt, /开头、核心信息和结尾都必须与该标题一致/);
});

test('局部换一批在结果未变化时由服务端自动重试', async () => {
  const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
  let calls = 0;
  const output = await modifyCopy({
    instruction: '写产品介绍', modification: '换一批正文，只重写正文并跟随当前选中的标题', platform: 'generic',
    currentCopy: '保留的旧正文', titleCandidates: ['当前标题'], selectedTitleIndex: 0, summary: null, topics: [], factSet,
  }, { deepSeekClient: async () => {
    calls += 1;
    return { titleCandidates: [], summary: null, bodyMarkdown: calls === 1 ? '保留的旧正文' : '围绕当前标题生成的全新正文', topics: [] };
  } });
  assert.equal(calls, 2);
  assert.equal(output.result.bodyMarkdown, '围绕当前标题生成的全新正文');
});

test('完整求职产品换正文时保留当前标题并使用事实安全变体', async () => {
  const instruction = '产品名是 Tlink。Tlink 是 AI 求职产品。目标用户是希望扩大岗位投递范围的求职者。目标用户需要向多个岗位重复提交简历。用户先设置求职方向，Tlink 根据该方向匹配岗位并自动投递简历。产品价值是减少手动重复投递操作，让用户把时间用于简历和面试准备。自动投递不保证获得面试，用户仍需要自行准备简历和面试。请写小红书产品介绍。';
  const factSet = buildFactSet({ instruction, materials: [] });
  const titleCandidates = ['扩大投递范围，Tlink 自动投简历', '自动投递的能力边界', '减少重复投递操作'];
  const currentCopy = '这是当前正文，内容需要换一批。';
  const output = await modifyCopy({
    instruction, modification: '换一批正文，只重写正文并跟随当前选中的标题', platform: 'xiaohongshu',
    currentCopy, titleCandidates, selectedTitleIndex: 0, summary: null, topics: ['AI求职', '求职工具', '简历投递'], factSet,
  }, { deepSeekClient: async () => ({
    titleCandidates: ['不应保留的新标题'], summary: null,
    bodyMarkdown: '每天都要重新填简历，Tlink 可以释放精力并提高求职效率。', topics: ['海投'],
  }) });
  assert.deepEqual(output.result.titleCandidates, titleCandidates);
  assert.equal(output.result.selectedTitleIndex, 0);
  assert.notEqual(output.result.bodyMarkdown, currentCopy);
  assert.match(output.result.bodyMarkdown, /扩大投递范围/);
  assert.match(output.result.bodyMarkdown, /自动投递不保证获得面试/);
  assert.doesNotMatch(output.result.bodyMarkdown, /每天|重新填|释放精力|提高求职效率/);
  assert.equal(output.result.qualityReport.status, 'ready');
});

test('已有正文的局部改写不会因资料评估返回 needs_input 或读取空 result', async () => {
  const sparseFactSet = { verifiedFacts: [], facts: [], opinions: [], experiences: [], unknowns: [], conflicts: [], knownNumbers: [], sourceMetadata: [] };
  const output = await modifyCopy({
    instruction: '写文案', modification: '换一批正文，只重写正文并跟随当前选中的标题；标题、摘要和话题保持不变',
    platform: 'xiaohongshu', currentCopy: '这是已经生成并由用户确认保留的正文。',
    titleCandidates: ['保留标题'], selectedTitleIndex: 0, summary: null, topics: ['保留话题'], factSet: sparseFactSet,
  });
  assert.equal(output.status, 'completed');
  assert.ok(output.result);
  assert.equal(output.result.summary, null);
  assert.deepEqual(output.result.titleCandidates, ['保留标题']);
  assert.deepEqual(output.result.topics, ['保留话题']);
});

test('质量检查识别平台、AI 腔和高风险表达', () => {
  const report = runQualityChecks({ titleCandidates: [], summary: null, bodyMarkdown: '在当今快速发展的时代，这是行业第一。', topics: [] }, PLATFORM_SPECS.xiaohongshu, { verifiedFacts: [], conflicts: [] });
  assert.equal(report.aiStyleCheck, 'warning');
  assert.equal(report.riskCheck, 'fail');
  assert.equal(report.status, 'blocked');
  assert.equal(report.platformCheck, 'fail');
});

test('截图中的 Tlink 文案不能通过小红书质量门', () => {
  const result = {
    titleCandidates: ['每天投简历到崩溃？试试这个AI助手', '别再手动海投了，AI帮你自动投简历', '求职季效率低？Tlink自动投递了解一下'],
    summary: null,
    bodyMarkdown: '每天打开招聘软件，筛选、改简历、重复投递，一天下来可能投了不到十家，还累得不行。\n如果你也卡在这一步，Tlink 这个 AI 求职工具可能适合你。\n它做的事情很简单：自动投简历。\n不过要提醒一句：自动投递不等于保证面试。\n但如果你只想扩大投递面，省下时间，Tlink 值得一试。',
    topics: ['AI求职', '自动投简历', '求职效率'],
    strategySnapshot: { contentType: 'product_marketing' },
  };
  const factSet = { verifiedFacts: [{ statement: 'Tlink 是 AI 求职产品，支持自动投简历。' }], conflicts: [], knownNumbers: [] };
  const report = runQualityChecks(result, PLATFORM_SPECS.xiaohongshu, factSet);
  assert.notEqual(report.status, 'ready');
  assert.equal(report.factCheck, 'fail');
  assert.equal(report.aiStyleCheck, 'warning');
  assert.match(report.warnings.join('\n'), /资料未支持.*(?:一天|十家)|模板化表达|旁观推荐/);
});

test('小红书产品文案不能自行补造操作步骤、用户情绪和营销修辞', () => {
  const result = {
    titleCandidates: ['投简历太累？Tlink 是求职者福音', '海投简历可以省时省力', '别再手动投简历了'],
    summary: null,
    bodyMarkdown: '如果你每天打开招聘网站，会发现重新填写、上传和提交很让人疲惫。\n\nTlink 支持自动投简历。\n\n它可以提高效率。\n\n不妨试试。',
    topics: ['AI求职', '自动投简历', '求职工具'],
    strategySnapshot: { contentType: 'product_marketing' },
  };
  const factSet = { verifiedFacts: [{ statement: 'Tlink 是 AI 求职产品，支持自动投简历。' }], conflicts: [], knownNumbers: [] };
  const report = runQualityChecks(result, PLATFORM_SPECS.xiaohongshu, factSet);
  assert.equal(report.status, 'blocked');
  assert.match(report.blockingErrors.join('\n'), /海投|疲惫|重新填写|上传|提高效率|福音/);
});

test('小红书产品文案在交付前确定性清理事实外场景词', () => {
  const factSet = {
    verifiedFacts: [
      { statement: '目标用户是希望扩大岗位投递范围的求职者。' },
      { statement: '目标用户需要向多个岗位重复提交简历。' },
      { statement: 'Tlink 根据求职方向匹配岗位并自动投递简历。' },
    ],
    conflicts: [],
    knownNumbers: [],
  };
  const repaired = enforceProductFactLanguage({
    titleCandidates: ['Tlink：设置方向后自动投简历', '海量投递可以省力'],
    summary: null,
    bodyMarkdown: '如果你正在经历海量投递的重复操作，Tlink 或许能帮你简化这一环节。\nTlink 根据求职方向匹配岗位并自动投递简历。\n这能减少手动重复投递的操作，让你不必在每个岗位上都重复填写和提交。',
    topics: ['AI求职', '海投'],
    commentPrompt: null,
    alternatives: [],
    strategySnapshot: { contentType: 'product_marketing' },
  }, PLATFORM_SPECS.xiaohongshu, factSet, 'product_marketing');
  assert.match(repaired.bodyMarkdown, /如果你正在向多个岗位重复投递/);
  assert.doesNotMatch(JSON.stringify(repaired), /海量|海投|省力|重复填写|不必在每个岗位/);
  assert.equal(runQualityChecks(repaired, PLATFORM_SPECS.xiaohongshu, factSet).factCheck, 'pass');
});

test('小红书产品文案不能把用户目标写成产品能力', () => {
  const result = {
    titleCandidates: ['Tlink 自动投递', '减少重复操作', '求职方向匹配岗位'], summary: null,
    bodyMarkdown: 'Tlink 的作用是帮你扩大投递范围。\n用户先设置求职方向，Tlink 根据方向匹配岗位并自动投递简历。\n自动投递不保证获得面试。\n用户仍需要自行准备简历和面试。',
    topics: ['AI求职', '求职工具', '简历投递'], strategySnapshot: { contentType: 'product_marketing' },
  };
  const factSet = { verifiedFacts: [{ statement: '目标用户是希望扩大岗位投递范围的求职者。' }, { statement: 'Tlink 根据求职方向匹配岗位并自动投递简历。' }], conflicts: [], knownNumbers: [] };
  assert.match(runQualityChecks(result, PLATFORM_SPECS.xiaohongshu, factSet).blockingErrors.join('\n'), /扩大投递范围/);
});

test('资料充分的小红书产品文案会补足事实型判断段落并满足长度门槛', () => {
  const factSet = {
    verifiedFacts: [
      { statement: '产品名是 Tlink。' },
      { statement: 'Tlink 是 AI 求职产品。' },
      { statement: '目标用户是希望扩大岗位投递范围的求职者。' },
      { statement: '目标用户需要向多个岗位重复提交简历。' },
      { statement: '用户先设置求职方向，Tlink 根据该方向匹配岗位并自动投递简历。' },
      { statement: '产品价值是减少手动重复投递操作，让用户把时间用于简历和面试准备。' },
      { statement: '自动投递不保证获得面试，用户仍需要自行准备简历和面试。' },
    ],
    conflicts: [], knownNumbers: [],
  };
  const repaired = enforceProductFactLanguage({
    titleCandidates: ['Tlink 自动投递怎么用', '扩大岗位投递范围', '减少重复投递操作'],
    summary: null,
    bodyMarkdown: '如果你希望扩大岗位投递范围，Tlink 可以处理重复投递。\n用户先设置求职方向，Tlink 根据方向匹配岗位并自动投递简历。\n它可以减少手动重复投递操作，让你把时间用于简历和面试准备。\n自动投递不保证获得面试。',
    topics: ['AI求职', '求职工具', '简历投递'], commentPrompt: null, alternatives: [],
    strategySnapshot: { contentType: 'product_marketing' },
  }, PLATFORM_SPECS.xiaohongshu, factSet, 'product_marketing', true);
  const report = runQualityChecks(repaired, PLATFORM_SPECS.xiaohongshu, factSet);
  assert.ok(report.bodyLength >= 320 && report.bodyLength <= 600);
  assert.doesNotMatch(report.blockingErrors.join('\n'), /320-600/);
});

test('正文低于自适应建议长度时给出建议但不阻断交付', () => {
  const factSet = { verifiedFacts: Array.from({ length: 4 }, (_, index) => ({ statement: `事实${index + 1}` })), conflicts: [], knownNumbers: [] };
  const report = runQualityChecks({ titleCandidates: ['标题一', '标题二', '标题三'], summary: null, bodyMarkdown: '这是一段过短正文。', topics: ['话题一', '话题二', '话题三'], strategySnapshot: { contentType: 'product_marketing' } }, PLATFORM_SPECS.xiaohongshu, factSet);
  assert.equal(report.status, 'ready_with_warnings');
  assert.equal(report.blockingErrors.length, 0);
  assert.match(report.warnings.join('\n'), /建议正文为/);
});

test('完整求职产品 Brief 最终使用结构化事实成稿，不保留模型补造内容', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'deepseek';
  const instruction = '产品名是 Tlink。Tlink 是 AI 求职产品。目标用户是希望扩大岗位投递范围的求职者。目标用户需要向多个岗位重复提交简历。用户先设置求职方向，Tlink 根据该方向匹配岗位并自动投递简历。产品价值是减少手动重复投递操作，让用户把时间用于简历和面试准备。自动投递不保证获得面试，用户仍需要自行准备简历和面试。请写小红书产品介绍。';
  try {
    const factSet = buildFactSet({ instruction, materials: [] });
    const output = await generateCopy({ instruction, platform: 'xiaohongshu', factSet }, {
      deepSeekClient: async () => ({
        titleCandidates: ['投简历投到怀疑人生', '求职效率翻倍', 'AI 求职神器'], summary: null,
        bodyMarkdown: '每天海投到手酸，只需上传简历就能提高求职效率，Tlink 可能适合你。',
        topics: ['AI求职', '求职效率', '海投'],
      }),
    });
    assert.notEqual(output.result.qualityReport.status, 'blocked');
    assert.ok(output.result.qualityReport.bodyLength >= 320 && output.result.qualityReport.bodyLength <= 600);
    assert.match(output.result.bodyMarkdown, /我们做 Tlink/);
    assert.match(output.result.bodyMarkdown, /不保证获得面试/);
    assert.doesNotMatch(JSON.stringify(output.result), /怀疑人生|翻倍|神器|每天|海投|手酸|上传|提高求职效率|可能适合你/);
  } finally { process.env.CONTENTFLOW_MODEL_MODE = previousMode; }
});

test('小红书生成合同要求产品方视角且禁止扩写未提供的产品流程', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'deepseek';
  let receivedPrompt = '';
  try {
    const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
    await generateCopy({ instruction: '写产品介绍', platform: 'xiaohongshu', factSet }, {
      deepSeekClient: async (prompt) => {
        receivedPrompt = prompt;
        return {
          titleCandidates: ['复杂团队先看权限边界', 'AI 写业务代码要先确认什么', '多租户系统如何控制写入'],
          summary: null,
          bodyMarkdown: `${'复杂业务系统接入 AI 前，权限和关键写入边界需要先说清楚。'.repeat(4)}\n\nOpen Mercato 支持多租户和 RBAC。\n\n关键写入动作需要人工确认。\n\n如果你负责复杂业务系统，可以先核对这些能力是否对应当前任务。`,
          topics: ['AI开发', '权限治理', '业务系统'],
        };
      },
    });
    assert.match(receivedPrompt, /产品团队面向目标用户/);
    assert.match(receivedPrompt, /事实里只有“自动投简历”时，就不能扩写成/);
    assert.match(receivedPrompt, /不得虚构每天、一次能做多少/);
  } finally { process.env.CONTENTFLOW_MODEL_MODE = previousMode; }
});

test('小红书模型草稿命中质量问题时最多自动修复两轮', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'deepseek';
  let calls = 0;
  const repairPrompts = [];
  try {
    const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
    const output = await generateCopy({ instruction: '写产品介绍', platform: 'xiaohongshu', factSet }, {
      deepSeekClient: async (prompt) => {
        calls += 1;
        repairPrompts.push(prompt);
        if (calls === 1) return {
          titleCandidates: ['工具值得一试', '工具了解一下', '这个工具可能适合你'],
          summary: null,
          bodyMarkdown: '这个工具可能适合你。\n它做的事情很简单。\n一天就能完成十次操作。\n值得一试。',
          topics: ['产品', '工具', 'AI'],
        };
        return {
          titleCandidates: ['复杂系统先看权限边界', 'AI 写业务代码要确认什么', '多租户研发如何约束写入'],
          summary: null,
          bodyMarkdown: `${'复杂业务系统引入 AI，先要判断权限与关键写入是否仍然可控。'.repeat(5)}\n\nOpen Mercato 支持多租户、RBAC 和工作流。\n\n关键写入动作需要人工确认，这让能力边界有明确落点。\n\n如果你负责复杂业务系统，可以对照这些已确认的能力判断是否适合当前团队。`,
          topics: ['AI开发', '权限治理', '多租户架构'],
        };
      },
    });
    assert.equal(calls, 3);
    assert.equal(output.result.autoRepaired, true);
    assert.equal(output.result.repairCount, 1);
    assert.match(repairPrompts[2], /最后一轮严格事实重写/);
    assert.doesNotMatch(output.result.bodyMarkdown, /值得一试|一天|十次/);
    assert.equal(output.result.qualityReport.factCheck, 'pass');
  } finally { process.env.CONTENTFLOW_MODEL_MODE = previousMode; }
});

test('小红书产品草稿经过事实语义审计、重写和复审', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'deepseek';
  let generationCalls = 0;
  let auditCalls = 0;
  try {
    const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
    const output = await generateCopy({ instruction: '写产品介绍', platform: 'xiaohongshu', factSet }, {
      deepSeekClient: async () => {
        generationCalls += 1;
        if (generationCalls === 1) return {
          titleCandidates: ['复杂系统先看权限边界', 'AI 写业务代码要确认什么', '多租户研发如何约束写入'],
          summary: null,
          bodyMarkdown: `${'每天开发者都会重复配置很多权限，这正是 Open Mercato 要解决的问题。'.repeat(5)}\n\nOpen Mercato 支持多租户、RBAC 和工作流。\n\n关键写入动作需要人工确认。\n\n如果你负责复杂业务系统，可以先判断这些能力是否适合当前团队。`,
          topics: ['AI开发', '权限治理', '多租户架构'],
        };
        return {
          titleCandidates: ['复杂系统先看权限边界', 'AI 写业务代码要确认什么', '多租户研发如何约束写入'],
          summary: null,
          bodyMarkdown: `${'复杂业务系统接入 AI 时，权限边界是否清楚，是一个值得先回答的问题。'.repeat(5)}\n\nOpen Mercato 支持多租户、RBAC 和工作流。\n\n它将关键写入动作保留给人工确认。\n\n如果你负责复杂业务系统，可以对照这些明确能力判断是否适合当前团队。`,
          topics: ['AI开发', '权限治理', '多租户架构'],
        };
      },
      semanticAuditClient: async () => {
        auditCalls += 1;
        return auditCalls === 1
          ? { unsupportedClaims: [{ claim: '每天开发者都会重复配置很多权限', reason: '事实未提供用户频率和行为' }] }
          : { unsupportedClaims: [{ claim: 'Open Mercato 支持多租户、RBAC 和工作流', reason: '审计模型误报的直接事实改写' }] };
      },
    });
    assert.equal(generationCalls, 3);
    assert.equal(auditCalls, 3);
    assert.equal(output.result.autoRepaired, true);
    assert.equal(output.result.qualityReport.semanticFactCheck, 'pass');
    assert.doesNotMatch(output.result.bodyMarkdown, /每天开发者/);
  } finally { process.env.CONTENTFLOW_MODEL_MODE = previousMode; }
});

test('Codex 成功时作为首选 provider', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'codex';
  let deepSeekCalled = false;
  try {
    const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
    const output = await generateCopy(
      { instruction: '写产品介绍', platform: 'xiaohongshu', tone: '自然', factSet },
      {
        codexClient: async () => ({ titleCandidates: ['标题'], summary: null, bodyMarkdown: '这是由 Codex 生成的完整正文，内容足够用于结构验证。', topics: ['产品'] }),
        deepSeekClient: async () => { deepSeekCalled = true; return null; },
      },
    );
    assert.equal(output.result.provider, 'codex-cli');
    assert.equal(deepSeekCalled, false);
  } finally { process.env.CONTENTFLOW_MODEL_MODE = previousMode; }
});

test('默认模式跳过 Codex 并优先使用 DeepSeek', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  const previousCodexEnabled = process.env.CONTENTFLOW_CODEX_ENABLED;
  delete process.env.CONTENTFLOW_MODEL_MODE;
  delete process.env.CONTENTFLOW_CODEX_ENABLED;
  let codexCalled = false;
  try {
    const factSet = buildFactSet({ instruction: '写产品介绍', materials: baseMaterials });
    const output = await generateCopy(
      { instruction: '写产品介绍', platform: 'xiaohongshu', tone: '自然', factSet },
      {
        codexClient: async () => { codexCalled = true; return null; },
        deepSeekClient: async () => ({ titleCandidates: ['标题'], summary: null, bodyMarkdown: '这是 DeepSeek 生成的完整正文，内容足够用于结构验证。', topics: [] }),
      },
    );
    assert.equal(codexCalled, false);
    assert.equal(output.result.provider, 'deepseek');
  } finally {
    if (previousMode === undefined) delete process.env.CONTENTFLOW_MODEL_MODE; else process.env.CONTENTFLOW_MODEL_MODE = previousMode;
    if (previousCodexEnabled === undefined) delete process.env.CONTENTFLOW_CODEX_ENABLED; else process.env.CONTENTFLOW_CODEX_ENABLED = previousCodexEnabled;
  }
});

test('Codex 失败后回退 DeepSeek，两个模型均失败后回退本地', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'codex';
  const request = { instruction: '写产品介绍', platform: 'xiaohongshu', tone: '自然', factSet: buildFactSet({ instruction: '写产品介绍', materials: baseMaterials }) };
  try {
    const deepSeek = await generateCopy(request, {
      codexClient: async () => { throw new Error('Codex unavailable'); },
      deepSeekClient: async () => ({ titleCandidates: ['标题'], summary: null, bodyMarkdown: '这是后备模型生成的完整正文，内容足够用于结构验证。', topics: [] }),
    });
    assert.equal(deepSeek.result.provider, 'deepseek');

    const local = await generateCopy(request, {
      codexClient: async () => { throw new Error('Codex unavailable'); },
      deepSeekClient: async () => { throw new Error('DeepSeek unavailable'); },
    });
    assert.equal(local.result.provider, 'local');
  } finally { process.env.CONTENTFLOW_MODEL_MODE = previousMode; }
});

test('请求取消后不再调用后备 provider', async () => {
  const previousMode = process.env.CONTENTFLOW_MODEL_MODE;
  process.env.CONTENTFLOW_MODEL_MODE = 'codex';
  const controller = new AbortController();
  let deepSeekCalled = false;
  try {
    const request = { instruction: '写产品介绍', platform: 'xiaohongshu', factSet: buildFactSet({ instruction: '写产品介绍', materials: baseMaterials }) };
    await assert.rejects(generateCopy(request, {
      signal: controller.signal,
      codexClient: async () => { controller.abort(); throw Object.assign(new Error('cancelled'), { code: 'ABORTED' }); },
      deepSeekClient: async () => { deepSeekCalled = true; return null; },
    }), /cancelled/);
    assert.equal(deepSeekCalled, false);
  } finally { process.env.CONTENTFLOW_MODEL_MODE = previousMode; }
});
