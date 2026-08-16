import crypto from 'node:crypto';
import { callCodex } from './codex-cli.js';
import { normalizePlatform, resolvePlatformSpec } from './platform-specs.js';
import { enforceProductFactLanguage, makeNatural, normalizeAndRepairResult, runQualityChecks } from './quality.js';
import { assessRequest, buildFactSet, createTaskBrief } from './task-understanding.js';
import { recommendStrategies } from './strategy-engine.js';
import { getPublicXhsFormatting, normalizeXhsFormattingOverride, resolveXhsFormattingProfile } from './xhs-formatting.js';

export { assessRequest, buildFactSet } from './task-understanding.js';

function factSetFromTask(taskBrief) {
  const evidence = [...(taskBrief.facts || []), ...(taskBrief.experiences || [])];
  const knownNumbers = [...new Set(evidence.flatMap((fact) => fact.statement.match(/\d+(?:\.\d+)?(?:%|倍|万|元|天|小时|分钟)?/g) || []))];
  return { verifiedFacts: taskBrief.facts || [], facts: taskBrief.facts || [], opinions: taskBrief.opinions || [], experiences: taskBrief.experiences || [], unknowns: taskBrief.unknowns || [], claimsRequiringConfirmation: [], conflicts: [], knownNumbers, sourceMetadata: [] };
}

function factsForPrompt(factSet) {
  const facts = factSet.verifiedFacts.map((fact) => `- [事实 ${fact.factId}] ${fact.statement}`);
  const opinions = (factSet.opinions || []).map((item) => `- [作者观点 ${item.opinionId}] ${item.statement}`);
  const experiences = (factSet.experiences || []).map((item) => `- [真实经历 ${item.experienceId}] ${item.statement}`);
  return [...facts, ...opinions, ...experiences].join('\n') || '- 没有额外资料，只能使用用户指令中明确给出的信息';
}

function outputContract(spec) {
  const base = { titleCandidates: [], summary: null, bodyMarkdown: '', topics: [] };
  if (spec.id === 'xiaohongshu') return { ...base, titleCandidates: ['标题1', '标题2', '标题3'], topics: ['话题1', '话题2', '话题3'], commentPrompt: null };
  if (spec.id === 'zhihu' && spec.mode === 'answer') return { ...base, mode: 'answer', questionTitle: '原问题', titleCandidates: [], summary: null };
  if (spec.id === 'zhihu') return { ...base, mode: 'article', titleCandidates: ['标题1', '标题2', '标题3'], summary: '摘要', topics: [] };
  if (spec.id === 'wechat') return { ...base, titleCandidates: ['标题1', '标题2', '标题3'], summary: '摘要', topics: [], mediaNotes: [] };
  return { ...base, purpose: '本次用途', titleCandidates: [], summary: null, topics: [], alternatives: [] };
}

export function buildGenerationPrompt({ instruction, tone, factSet, taskBrief, strategy, spec, formattingProfile = null, currentCopy = '', action = 'generate' }) {
  const editContext = currentCopy ? `\n当前文案（修改时必须以此版本为准）：\n${currentCopy}` : '';
  const productVoice = spec.id === 'xiaohongshu' && taskBrief.contentType === 'product_marketing'
    ? `\n产品营销附加合同：
- 以产品团队面向目标用户的口吻写，不使用第三方测评、资料转述或旁观推荐口吻。
- 可以客观说“我们做这项能力是为了解决什么问题”，但不得声称团队亲自使用后取得了某种结果。
- 场景只能用条件式表达，例如“如果你正在……”，不能编写用户每天做什么、做了多少、通常遇到什么结果。
- 产品的能力、使用步骤、匹配逻辑和效果必须是“可使用事实”的直接转述。事实里只有“自动投简历”时，就不能扩写成“设置方向、匹配岗位、自动筛选或优化简历”。
- 没有量化数据时，直接根据已提供的产品定位和能力写非量化价值，不得自行补数字、案例或效果结论。
- 信息较少时允许生成更短、更聚焦的宣传文案，不在正文中显示待补充项，不得靠常识补齐产品细节。`
    : '';
  const lengthContract = formattingProfile
    ? `\n本次资料量：${formattingProfile.materialDensity}。正文目标 ${formattingProfile.lengthTarget.bodyMin}-${formattingProfile.lengthTarget.bodyMax} 个中文字符。目标长度用于控制篇幅，不是补造事实的理由；资料少时宁可写短。`
    : '';
  const formattingContract = formattingProfile ? `
小红书运行时排版合同：
- 平台感：${formattingProfile.platformFeelLabel}（${formattingProfile.platformFeel}）
- 内容结构：${formattingProfile.structure.join(' -> ')}
- Hook 类型：${formattingProfile.hookType}，前 80 字只使用一个主 Hook
- 段落：通常每段 ${formattingProfile.paragraphPolicy.sentencesPerParagraph.join('-')} 句，连续文本块不超过 ${formattingProfile.paragraphPolicy.maxContinuousCharacters} 字，段落长短要有变化
- Emoji：正文使用 ${formattingProfile.emojiPolicy.recommendedMin}-${formattingProfile.emojiPolicy.maxCount} 个，只能用于 ${formattingProfile.emojiPolicy.allowedRoles.join('、')}；作为段落或信息锚点，不得每句结尾添加或连续堆叠
- CTA：${formattingProfile.ctaMode}，正文最多一个主行动，评论问题最多一个
- 话题：大类 1-2 个、品类 2-3 个、场景或受众 1-2 个、品牌词 0-1 个，总数 3-8 个并去除同义重复
- 正文不使用 Markdown 标题和加粗符号模拟小红书排版
` : '';
  return `你是 Narraform 中文内容编辑。严格执行本次生成合同，只返回 JSON。

事实安全：
- 只能使用“可使用事实”中的产品能力、数字、日期、价格、经历、案例和结果。
- 不得补造客户、数字、经历、排名、效果、价格、日期或产品能力。
- 不提及 README、文件名、路径、资料来源、模型、提示词或生成过程。
- 不伪造第一人称体验、专业身份、用户评价或测试结果。
- 没有“真实经历”事实时，也不得省略主语写成“最近用了”“前段时间试了”“这几天在用”等亲历口吻；改写成产品能力或使用场景的客观描述。
- 受众和痛点如果标记为 inferred，只能作为表达对象，不能写成调研结论。
- 用户未要求营销时，不添加购买、关注、私信或强行动号召。

平台：${spec.label}
平台模式：${spec.mode || 'default'}
规范版本：${spec.version}
推荐长度：${spec.recommended.min}-${spec.recommended.max} 中文字符
推荐结构：${spec.structure}
结构规则：
${spec.structureRules.map((rule) => `- ${rule}`).join('\n')}
标题规则：
${(spec.titleRules.length ? spec.titleRules : ['- 无独立标题字段']).map((rule) => rule.startsWith('- ') ? rule : `- ${rule}`).join('\n')}
表达规则：
${spec.styleRules.map((rule) => `- ${rule}`).join('\n')}
CTA 规则：
${spec.ctaRules.map((rule) => `- ${rule}`).join('\n')}
  禁止模式：
  ${spec.forbiddenPatterns.map((rule) => `- ${rule}`).join('\n')}
  交付前自检：
  ${(spec.qualityRules || []).map((rule) => `- ${rule}`).join('\n') || '- 所有字段符合平台合同'}${productVoice}${lengthContract}
${formattingContract}

用户要求：${instruction}
操作：${action}
表达风格：${tone || taskBrief.tone || '自然、专业'}
内容类型：${taskBrief.contentType}
任务主体：${taskBrief.subject.name}
知乎问题：${taskBrief.questionTitle || '无'}
用户确认的策略：${JSON.stringify(strategy)}

可使用事实：
${factsForPrompt(factSet)}${editContext}

输出字段必须符合下面的 JSON 形状，不要 Markdown 代码块：
${JSON.stringify(outputContract(spec), null, 2)}

  bodyMarkdown 不要包含小红书话题标签；话题只放在 topics。没有字段内容时使用 null 或空数组，不得删除固定字段。输出前静默逐项检查，不要把检查过程写进正文。`;
}

function buildQualityRepairPrompt({ generationPrompt, result, issues, attempt = 1, formattingProfile = null }) {
  const targetLength = formattingProfile ? `${formattingProfile.lengthTarget.bodyMin}-${formattingProfile.lengthTarget.bodyMax}` : '推荐范围';
  const strictRewrite = attempt === 2 ? `

这是最后一轮严格事实重写：
- 标题只组合可使用事实中的产品名、能力、受众、使用方式和边界，不添加情绪、效果、痛点修辞或推荐口号。
- 正文不要创作新的用户场景；开头直接改写可使用事实中的用户任务或判断条件。
- 每一段至少能指出它改写自哪一条事实。找不到支持事实的句子直接删除。
- 使用不同段落分别解释受众、现有任务、使用方式、核心作用和明确边界，正文控制在 ${targetLength} 字，不靠同义反复凑字数。`
    : '';
  return `${generationPrompt}

上一次草稿没有通过交付检查。只修复下面列出的问题，并重新返回完整 JSON：
${issues.map((issue) => `- ${issue}`).join('\n')}

上一次草稿：
${JSON.stringify({ titleCandidates: result.titleCandidates, summary: result.summary, bodyMarkdown: result.bodyMarkdown, topics: result.topics, commentPrompt: result.commentPrompt }, null, 2)}

修复要求：
- 不得增加“可使用事实”之外的产品能力、步骤、数字、效果或用户经历。
- 删除无依据内容比换一种说法保留它更重要。
- 不要用空话凑字数；事实不足时允许保留长度提醒。
- 返回完整 JSON，不要解释修改过程。${strictRewrite}`;
}

function buildSemanticAuditPrompt({ result, factSet }) {
  return `你是中文产品文案的事实审计员。只做审计，只返回 JSON。

可使用事实：
${factsForPrompt(factSet)}

待审计草稿：
${JSON.stringify({ titleCandidates: result.titleCandidates, bodyMarkdown: result.bodyMarkdown, topics: result.topics }, null, 2)}

逐句检查标题和正文。先为每个声明寻找可以支持它的事实 ID；直接改写、缩写和不改变含义的条件式表达都算有支持，不得列入 unsupportedClaims。以下内容只有在找不到任何支持事实时，才属于 unsupportedClaims：
- 产品能力、操作步骤、工作流程、设计意图、效果、比较、限制和适用边界；
- 具体用户习惯、频率、数量、结果或看似真实的使用场景；
- 把“自动完成某动作”扩写成输入里没有的前置步骤、关联能力或效果。

一般性的条件句可以保留，但不能借条件句暗示产品具备未提供的能力。不要把常识当作产品事实。

例如，事实是“产品面向希望扩大投递范围的求职者”时，“适合希望扩大投递范围的求职者”是有支持的改写；但“海投到手酸”不是。

固定输出：
{"unsupportedClaims":[{"claim":"草稿中的原句或最小片段","reason":"为什么现有事实不支持"}]}

没有问题时返回空数组。不要返回 Markdown。`;
}

function groundingUnits(text = '') {
  const compact = [...text.toLowerCase().replace(/[\s，。！？、：；,.!?:;《》“”"']/g, '')];
  return new Set(compact.slice(0, -1).map((char, index) => `${char}${compact[index + 1]}`));
}

function groundingSimilarity(left, right) {
  const a = groundingUnits(left); const b = groundingUnits(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((item) => b.has(item)).length;
  return overlap / Math.min(a.size, b.size);
}

function isGroundedParaphrase(claim, factSet) {
  return (factSet.verifiedFacts || []).some((fact) => groundingSimilarity(claim, fact.statement) >= 0.45);
}

function applySemanticAudit(result, audit, factSet) {
  const claims = (Array.isArray(audit?.unsupportedClaims)
    ? audit.unsupportedClaims.map((item) => typeof item === 'string' ? item : item?.claim).filter(Boolean)
    : []).filter((claim) => !isGroundedParaphrase(claim, factSet));
  result.qualityReport.semanticFactCheck = claims.length ? 'fail' : 'pass';
  result.qualityReport.unsupportedClaims = claims;
  if (!claims.length) return result;
  const errors = claims.map((claim) => `发现可用事实未支持的内容：${claim}`);
  result.qualityReport.blockingErrors.push(...errors);
  result.qualityReport.warnings.push(...errors);
  result.qualityReport.autoRepairIssues.push(...claims.map((claim) => `删除或严格改写这条无事实支持的内容：${claim}`));
  result.qualityReport.factCheck = 'fail';
  result.qualityReport.status = 'blocked';
  return result;
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{'); const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('模型没有返回可识别的 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function callDeepSeek(prompt, signal) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || process.env.CONTENTFLOW_MODEL_MODE === 'local') return null;
  const response = await fetch(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', temperature: 0.55, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }), signal,
  });
  if (!response.ok) throw new Error(`模型服务返回 ${response.status}`);
  const data = await response.json();
  return extractJson(data.choices?.[0]?.message?.content || '');
}

function subjectFrom(taskBrief, factSet) {
  return (taskBrief.subject.name || factSet.verifiedFacts[0]?.statement || '这个主题').replace(/[。！？\n].*$/, '').slice(0, 42);
}

function localGenerate({ taskBrief, strategy, spec, factSet, formattingProfile = null, variation = 0 }) {
  const subject = subjectFrom(taskBrief, factSet);
  const facts = factSet.verifiedFacts.slice(0, 6).map((fact) => fact.statement.replace(/[。！？]+$/, ''));
  const concrete = facts.length ? facts : [taskBrief.instruction.replace(/[。！？]+$/, '')];
  const different = variation % 2 === 1;
  if (spec.id === 'xiaohongshu') {
    const factParagraphs = concrete.slice(0, 5).map((item) => `${item}。`);
    const activeAnchor = formattingProfile?.platformFeel === 'active' && formattingProfile.emojiPolicy.maxCount > 0 ? '📌 ' : '';
    const opening = different
      ? `判断${subject}是否适合自己，先看它对应的具体任务，不需要先接受一串宣传词。`
      : `了解${subject}，最值得先确认的是它解决什么问题，以及能力边界是否对应你的实际需要。`;
    return {
      titleCandidates: different
        ? [`先别急着选，看看${subject.slice(0, 9)}`, `${subject.slice(0, 10)}到底解决什么`, `什么情况更适合${subject.slice(0, 8)}`]
        : [`${subject.slice(0, 12)}，先解决这个问题`, `${subject.slice(0, 11)}适合什么情况`, `别只看功能，先看实际作用`], summary: null,
      bodyMarkdown: [opening, ...factParagraphs.map((paragraph, index) => index === 0 ? `${activeAnchor}${paragraph}` : paragraph), `如果你是${strategy.audience?.label || '正在判断相关方案的读者'}，可以先对照上面已经确认的能力。没有写明的流程、效果和限制，需要进一步确认后再作判断。`].join('\n\n'),
      topics: ['内容创作', taskBrief.contentType === 'product_marketing' ? '产品分享' : '实用方法', '真实表达'], commentPrompt: '你现在最想先解决哪个具体环节？',
    };
  }
  if (spec.id === 'zhihu' && spec.mode === 'answer') {
    return { mode: 'answer', questionTitle: taskBrief.questionTitle, titleCandidates: [], summary: null, topics: [], bodyMarkdown: `核心判断是：${concrete[0]}。\n\n## 先看决定结果的条件\n\n${concrete.slice(1, 3).map((item) => `${item}。`).join('') || '这件事不能只看功能数量，还要看目标、使用条件和执行成本。'}\n\n## 真正需要核对的信息\n\n${concrete.slice(3, 6).map((item) => `${item}。`).join('') || '每个结论都应该能回到明确事实，而不是用看似完整的说法填补空白。'}\n\n## 适用边界\n\n这套判断适合已经有明确目标和基础信息的情况。如果关键事实仍不确定，应该先补充信息，再决定具体方案。` };
  }
  if (spec.id === 'zhihu') {
    const titles = different
      ? [`判断${subject.slice(0, 20)}，关键不是功能多少`, `${subject.slice(0, 19)}适合谁，又不适合谁`, `从实际任务看${subject.slice(0, 18)}的价值`]
      : [`${subject.slice(0, 22)}，应该怎样判断？`, `理解${subject.slice(0, 20)}，先看这几个条件`, `${subject.slice(0, 20)}的实际作用和边界`];
    return { mode: 'article', titleCandidates: titles, summary: '这篇内容从具体任务出发，解释可核对的能力、适用条件和限制，帮助读者形成自己的判断。', topics: [], bodyMarkdown: `很多讨论的问题不在于信息太少，而在于没有说明这些信息怎样影响判断。${concrete[0]}。\n\n## 先明确要解决的任务\n\n${concrete.slice(1, 3).map((item) => `${item}。`).join('') || '目标不同，后续判断标准也会不同。'}\n\n## 把能力放回实际场景\n\n${concrete.slice(3, 6).map((item) => `${item}。`).join('') || '能力只有对应到具体任务、对象和使用条件时，才有可判断的价值。'}\n\n## 需要保留的边界\n\n这套方法适合已有明确目标和基础资料的情况。如果关键事实缺失，应该先补充信息，而不是用确定语气填补空白。` };
  }
  if (spec.id === 'wechat') {
    const titles = different
      ? [`${subject.slice(0, 20)}，真正值得关注的是什么`, `不只罗列功能：重新说明${subject.slice(0, 14)}`, `${subject.slice(0, 18)}的价值，需要放回场景里看`]
      : [`${subject.slice(0, 22)}：先把问题和边界说清楚`, `从具体任务出发，重新理解${subject.slice(0, 16)}`, `${subject.slice(0, 20)}如何真正作用于日常工作`];
    return { titleCandidates: titles, summary: '围绕读者面对的具体任务，本文解释相关能力如何发挥作用、适合哪些情况，以及使用前需要确认的条件和边界。', topics: [], mediaNotes: [], bodyMarkdown: `很多内容的问题不是信息太少，而是没有说明这些信息和读者有什么关系。${concrete[0]}。\n\n## 从读者的问题开始\n\n${concrete.slice(1, 3).map((item) => `${item}。`).join('')}先建立阅读理由，后面的能力和观点才有上下文。\n\n## 把能力写成具体作用\n\n${concrete.slice(3, 6).map((item) => `${item}。`).join('') || '与其罗列名词，不如说明每项能力解决什么任务、在什么条件下发挥作用。'}\n\n## 哪些条件不能省略\n\n可信的文章不需要把所有事情都说成优势。哪些信息已经确认、哪些结论只适用于特定场景，都应该清楚表达。\n\n## 留给读者的判断\n\n内容最终要帮助读者作出决定，而不是只留下几个听起来正确的词。` };
  }
  return { purpose: taskBrief.purpose, titleCandidates: [], summary: null, topics: [], alternatives: [], bodyMarkdown: concrete.map((item) => `${item}。`).join('\n\n') };
}

function structuredJobProductCopy(factSet, { mode = 'initial', selectedTitle = '', currentCopy = '' } = {}) {
  const statements = (factSet.verifiedFacts || []).map((fact) => fact.statement.replace(/[。！？]+$/, '').trim());
  const findValue = (pattern) => statements.map((statement) => statement.match(pattern)?.[1]?.trim()).find(Boolean);
  const name = findValue(/^产品名是\s*(.+)$/);
  const category = name && statements.find((statement) => statement.startsWith(`${name} 是`) && /AI\s*求职产品/.test(statement));
  const audience = findValue(/^目标用户是\s*(.+)$/);
  const need = findValue(/^目标用户需要\s*(.+)$/);
  const workflow = statements.find((statement) => /求职方向/.test(statement) && /匹配岗位/.test(statement) && /自动投递简历/.test(statement));
  const value = findValue(/^产品价值是\s*(.+)$/);
  const boundary = statements.find((statement) => /自动投递不保证获得面试/.test(statement) && /仍需要自行准备简历和面试/.test(statement));
  if (!name || !category || !audience || !need || !workflow || !value || !boundary) return null;

  const audienceGoal = audience.replace(/的求职者$/, '');
  const directWorkflow = workflow.replace(/^用户/, '你').replaceAll('该方向', '这个方向').replace('并自动投递', '再自动投递');
  const directValue = value.replaceAll('用户', '你');
  const directBoundary = boundary.replaceAll('用户', '你');
  const initialParagraphs = [
    `如果你${audienceGoal}，同时需要${need}，${name} 面向的就是这项具体任务。`,
    `我们做 ${name}，是为了${directValue}。${category}。`,
    `具体使用时，${directWorkflow}。方向由你设置，岗位匹配和简历投递由 ${name} 按这个方向完成；简历和面试准备仍由你自己完成。`,
    `适不适合 ${name}，主要看你的当前任务：是否${audienceGoal}，是否需要${need}。符合这些情况时，${name} 对应的是其中的重复投递环节。`,
    `边界也需要说清楚：${directBoundary}。${name} 减少的是重复投递操作，不替代求职准备，也不承诺面试结果。`,
  ];
  const bodySections = {
    audience: `如果你${audienceGoal}，同时需要${need}，投递环节就包含需要重复完成的任务。${name} 面向的正是这部分操作。`,
    workflow: `使用 ${name} 时，${directWorkflow}。方向由你设置，岗位匹配和简历投递由 ${name} 按这个方向完成。`,
    value: `我们做 ${name}，是为了${directValue}。产品减少的是向多个岗位重复提交简历时的手动操作。`,
    boundary: `自动投递的边界同样明确：${directBoundary}。${name} 不替代求职准备，也不承诺面试结果。`,
    decision: `判断是否适合，重点看 ${name} 负责的投递环节是否对应你的当前任务。希望扩大投递范围、需要向多个岗位重复提交简历时，这项能力与需求直接相关；简历和面试仍由你自己准备。`,
  };
  let bodyParagraphs = initialParagraphs;
  if (mode === 'body') {
    let preferred = /边界|不保证|面试/.test(selectedTitle) ? 'boundary'
      : /设置|方向|匹配/.test(selectedTitle) ? 'workflow'
        : /减少|重复|时间/.test(selectedTitle) ? 'value' : 'audience';
    const currentOpening = currentCopy.trim().startsWith(bodySections[preferred].slice(0, 12));
    if (currentOpening) preferred = preferred === 'audience' ? 'workflow' : 'audience';
    bodyParagraphs = [preferred, ...['audience', 'workflow', 'value', 'boundary'].filter((key) => key !== preferred), 'decision'].map((key) => bodySections[key]);
  }
  return {
    titleCandidates: [
      `${name}：设置方向后自动投递`,
      `多岗位投简历，先看 ${name}`,
      '减少重复投递，把时间用于准备',
      '自动投递不保证面试，边界先说清',
      `${name} 适合什么样的求职者`,
    ],
    summary: null,
    bodyMarkdown: bodyParagraphs.join('\n\n'),
    topics: ['AI求职', '求职工具', '简历投递'],
    commentPrompt: null,
  };
}

function normalizeResult(raw, { platform, spec, taskBrief, factSet, formattingProfile = null, formattingOverride = {}, removedTopics = [] }) {
  const base = {
    resultId: crypto.randomUUID(), platform, platformMode: spec.mode, mode: raw.mode || spec.mode || null,
    questionTitle: raw.questionTitle || taskBrief.questionTitle || null,
    titleCandidates: Array.isArray(raw.titleCandidates) ? raw.titleCandidates : [], summary: raw.summary ?? null,
    bodyMarkdown: raw.bodyMarkdown || '', topics: Array.isArray(raw.topics) ? raw.topics : [],
    commentPrompt: raw.commentPrompt || null, mediaNotes: Array.isArray(raw.mediaNotes) ? raw.mediaNotes : [],
    purpose: raw.purpose || taskBrief.purpose || null, alternatives: Array.isArray(raw.alternatives) ? raw.alternatives : [],
    formatting: spec.id === 'xiaohongshu' ? getPublicXhsFormatting(formattingProfile) : null,
    formattingOverride: spec.id === 'xiaohongshu' ? normalizeXhsFormattingOverride(formattingOverride) : null,
    removedTopics: spec.id === 'xiaohongshu' ? [...new Set(removedTopics)] : [],
    platformSpecVersion: spec.version,
  };
  return enforceProductFactLanguage(normalizeAndRepairResult(base, spec, { taskBrief, factSet, formattingProfile, removedTopics, applyFormattingRepair: true }), spec, factSet, taskBrief.contentType);
}

export async function generateCopy(request, { signal, codexClient = callCodex, deepSeekClient = callDeepSeek, semanticAuditClient = null } = {}) {
  const platform = normalizePlatform(request.platform || request.taskBrief?.platform);
  const created = request.taskBrief ? null : createTaskBrief({ ...request, platform });
  const taskBrief = request.taskBrief || created.taskBrief;
  const factSet = request.factSet || (request.taskBrief ? factSetFromTask(taskBrief) : created.factSet);
  const assessment = assessRequest({ instruction: request.instruction || taskBrief.instruction, factSet, platform, platformMode: request.platformMode || taskBrief.platformMode, taskBrief });
  const modifyingExistingCopy = String(request.action || '').startsWith('modify') && Boolean(request.currentCopy?.trim());
  if (!assessment.enough && !modifyingExistingCopy) return { status: 'needs_input', questions: assessment.questions, factSet, taskBrief };
  const spec = resolvePlatformSpec(platform, request.platformMode || taskBrief.platformMode, request.instruction || taskBrief.instruction);
  const options = taskBrief.strategyOptions?.length ? taskBrief.strategyOptions : recommendStrategies(taskBrief);
  const strategy = request.strategy || options.find((item) => item.id === (request.strategyId || taskBrief.selectedStrategyId)) || options[0];
  if (!strategy) throw new Error('没有可用的内容策略');
  const formattingOverride = normalizeXhsFormattingOverride(request.formattingOverride || request.currentResult?.formattingOverride || {});
  const formattingProfile = spec.id === 'xiaohongshu'
    ? request.formattingProfile || resolveXhsFormattingProfile({ taskBrief, strategy, userOverride: formattingOverride, tone: request.tone || taskBrief.tone })
    : null;
  const removedTopics = request.removedTopics || request.currentResult?.removedTopics || [];
  const prompt = buildGenerationPrompt({ ...request, instruction: request.instruction || taskBrief.instruction, platform, factSet, taskBrief, strategy, spec, formattingProfile, action: request.action || 'generate' });
  let raw; let provider = 'local'; let modelError;
  const modelMode = process.env.CONTENTFLOW_MODEL_MODE || 'deepseek';
  const codexEnabled = modelMode !== 'local' && process.env.CONTENTFLOW_CODEX_ENABLED !== '0' && (process.env.CONTENTFLOW_CODEX_ENABLED === '1' || modelMode === 'codex');
  if (codexEnabled) {
    try { raw = await codexClient(prompt, { signal }); if (raw) provider = 'codex-cli'; }
    catch (error) { if (signal?.aborted || error?.code === 'ABORTED') throw error; modelError = error; }
  }
  if (!raw) try { raw = await deepSeekClient(prompt, signal); if (raw) provider = 'deepseek'; }
  catch (error) { if (signal?.aborted || error?.name === 'AbortError') throw error; modelError ||= error; }
  if (!raw && process.env.CONTENTFLOW_MODEL_STRICT === '1' && modelError) throw modelError;
  raw ||= localGenerate({ taskBrief, strategy, spec, factSet, formattingProfile, variation: request.variation || 0 });
  const decorate = (candidate) => {
    candidate.strategySnapshot = { ...strategy, contentType: taskBrief.contentType };
    candidate.factIds = [...factSet.verifiedFacts, ...(factSet.experiences || [])].map((fact) => fact.factId).filter(Boolean);
    candidate.specVersion = spec.version; candidate.provider = provider; candidate.taskId = taskBrief.taskId; candidate.strategyId = strategy.id;
    candidate.formatting = spec.id === 'xiaohongshu' ? getPublicXhsFormatting(formattingProfile) : null;
    candidate.formattingOverride = spec.id === 'xiaohongshu' ? formattingOverride : null;
    candidate.platformSpecVersion = spec.version;
    candidate.qualityReport = runQualityChecks(candidate, spec, factSet, { taskBrief, strategy, formattingProfile });
    return candidate;
  };
  const auditClient = semanticAuditClient || (provider === 'deepseek' && deepSeekClient === callDeepSeek ? deepSeekClient : null);
  const audit = async (candidate) => {
    if (!auditClient || spec.id !== 'xiaohongshu' || taskBrief.contentType !== 'product_marketing') return candidate;
    try {
      return applySemanticAudit(candidate, await auditClient(buildSemanticAuditPrompt({ result: candidate, factSet }), signal), factSet);
    } catch (error) {
      if (signal?.aborted || error?.code === 'ABORTED' || error?.name === 'AbortError') throw error;
      candidate.qualityReport.semanticFactCheck = 'unavailable';
      return candidate;
    }
  };
  let result = await audit(decorate(normalizeResult(raw, { platform, spec, taskBrief, factSet, formattingProfile, formattingOverride, removedTopics })));
  const score = (candidate) => candidate.qualityReport.blockingErrors.length * 20 + candidate.qualityReport.warnings.length;
  if (spec.id === 'xiaohongshu' && provider !== 'local') {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const repairIssues = result.qualityReport.autoRepairIssues || [];
      if (!repairIssues.length) break;
    try {
      const repairPrompt = buildQualityRepairPrompt({ generationPrompt: prompt, result, issues: repairIssues, attempt, formattingProfile });
      const repairedRaw = provider === 'codex-cli'
        ? await codexClient(repairPrompt, { signal })
        : await deepSeekClient(repairPrompt, signal);
      if (repairedRaw) {
        const repaired = await audit(decorate(normalizeResult(repairedRaw, { platform, spec, taskBrief, factSet, formattingProfile, formattingOverride, removedTopics })));
        if (score(repaired) < score(result)) {
          result = repaired;
          result.autoRepaired = true;
          result.repairCount = attempt;
        } else break;
      }
    } catch (error) {
      if (signal?.aborted || error?.code === 'ABORTED' || error?.name === 'AbortError') throw error;
      break;
    }
    }
  }
  const selectedTitle = request.titleCandidates?.[Math.min(request.selectedTitleIndex || 0, Math.max(0, (request.titleCandidates?.length || 1) - 1))] || '';
  const groundedRaw = spec.id === 'xiaohongshu' && taskBrief.contentType === 'product_marketing' && request.action !== 'modify_titles'
    ? structuredJobProductCopy(factSet, { mode: request.action === 'modify_body' ? 'body' : 'initial', selectedTitle, currentCopy: request.currentCopy || '' })
    : null;
  if (groundedRaw) {
    const grounded = await audit(decorate(normalizeResult(groundedRaw, { platform, spec, taskBrief, factSet, formattingProfile, formattingOverride, removedTopics })));
    if (!grounded.qualityReport.blockingErrors.length && score(grounded) <= score(result)) {
      result = grounded;
      result.autoRepaired = true;
      result.repairCount = Math.max(result.repairCount || 0, 2);
    }
  }
  return { status: 'completed', result, factSet, taskBrief };
}

export async function modifyCopy(request, options = {}) {
  const intent = request.modification || '';
  const platform = normalizePlatform(request.platform);
  const taskBrief = request.taskBrief || createTaskBrief({ instruction: request.instruction || intent, platform, platformMode: request.platformMode, tone: request.tone, materials: request.materials || [], factSet: request.factSet }).taskBrief;
  const factSet = request.factSet || factSetFromTask(taskBrief);
  const spec = resolvePlatformSpec(platform, request.platformMode || taskBrief.platformMode, intent);
  const generateModification = async (input, accepts = (output) => Boolean(output?.result)) => {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const output = await generateCopy({ ...input, variation: (input.variation || 0) + attempt }, options);
        if (output?.status === 'completed' && output.result && accepts(output)) return output;
        lastError = new Error('修改结果不完整或与当前版本没有差异');
      } catch (error) {
        if (options.signal?.aborted || error?.code === 'ABORTED' || error?.name === 'AbortError') throw error;
        lastError = error;
      }
    }
    throw lastError || new Error('修改任务内部重试失败');
  };
  if (/(?:换一(?:批|版)|只(?:修改|重写|更换))正文/.test(intent)) {
    const titleCandidates = request.titleCandidates || [];
    const selectedTitleIndex = Math.min(request.selectedTitleIndex ?? 0, Math.max(0, titleCandidates.length - 1));
    const selectedTitle = titleCandidates[selectedTitleIndex] || '';
    const generated = await generateModification({
      ...request,
      taskBrief,
      factSet,
      instruction: `${request.instruction || taskBrief.instruction}\n修改要求：只重写正文。当前选中标题“${selectedTitle}”是最高约束，新正文的开头、核心信息和结尾都必须与该标题一致；与当前正文采用明显不同的表达或结构，但不得增加新事实；不要修改标题、摘要和话题。`,
      action: 'modify_body',
      variation: (request.variation || 0) + 1,
    }, (output) => output.result.bodyMarkdown?.trim() && output.result.bodyMarkdown.trim() !== request.currentCopy.trim());
    const result = {
      ...generated.result,
      titleCandidates,
      selectedTitleIndex,
      summary: request.summary ?? generated.result.summary,
      topics: request.topics || [],
    };
    result.qualityReport = runQualityChecks(result, spec, factSet);
    return { ...generated, result };
  }
  if (/标题/.test(intent) && /(?:只修改|只更换|换一批)/.test(intent)) {
    const previousTitles = request.titleCandidates || [];
    const generated = await generateModification({
      ...request,
      taskBrief,
      factSet,
      instruction: `${request.instruction || taskBrief.instruction}\n修改要求：只生成一批全新标题。每个标题都必须准确概括当前正文的真实内容，不能引入正文没有的功能、场景、效果或观点；标题角度要彼此不同，并与现有标题有明显差异；正文、摘要和话题保持不变。`,
      action: 'modify_titles',
      variation: (request.variation || 0) + 1,
    }, (output) => output.result.titleCandidates?.length > 0 && JSON.stringify(output.result.titleCandidates) !== JSON.stringify(previousTitles));
    const result = {
      ...generated.result,
      selectedTitleIndex: 0,
      summary: request.summary ?? generated.result.summary,
      bodyMarkdown: request.currentCopy,
      topics: request.topics || [],
    };
    result.qualityReport = runQualityChecks(result, spec, factSet);
    return { ...generated, result };
  }
  if (/更自然|不要.*ai|去.*ai/.test(intent)) {
    const result = normalizeResult({ titleCandidates: request.titleCandidates || [], summary: request.summary, bodyMarkdown: makeNatural(request.currentCopy), topics: request.topics || [], mode: spec.mode, questionTitle: taskBrief.questionTitle, purpose: taskBrief.purpose }, { platform, spec, taskBrief });
    result.selectedTitleIndex = request.selectedTitleIndex || 0;
    result.qualityReport = runQualityChecks(result, spec, factSet); result.strategySnapshot = request.strategy || taskBrief.strategyOptions?.[0] || recommendStrategies(taskBrief)[0];
    result.factIds = [...factSet.verifiedFacts, ...(factSet.experiences || [])].map((fact) => fact.factId).filter(Boolean); result.specVersion = spec.version; result.provider = 'local-transform'; result.taskId = taskBrief.taskId; result.strategyId = request.strategyId || result.strategySnapshot.id;
    return { status: 'completed', result, factSet, taskBrief };
  }
  if (/精简|缩短/.test(intent)) {
    const paragraphs = request.currentCopy.split(/\n{2,}/).filter(Boolean);
    const shortened = paragraphs.slice(0, Math.max(1, Math.ceil(paragraphs.length * 0.65))).map((part) => part.length > 180 ? `${part.slice(0, 170)}。` : part).join('\n\n');
    return modifyCopy({ ...request, taskBrief, factSet, currentCopy: shortened, modification: '更自然' }, options);
  }
  const aliases = [['小红书', 'xiaohongshu'], ['知乎', 'zhihu'], ['公众号', 'wechat'], ['通用', 'generic']];
  const target = aliases.find(([label]) => intent.includes(label))?.[1] || platform;
  const targetMode = target === 'zhihu' ? (/回答/.test(intent) ? 'answer' : /文章|专栏|长文/.test(intent) ? 'article' : request.platformMode) : null;
  return generateModification({ ...request, taskBrief: { ...taskBrief, platform: target, platformMode: targetMode }, factSet, platform: target, platformMode: targetMode, instruction: `${request.instruction || taskBrief.instruction}\n修改要求：${intent}`, action: 'modify', variation: (request.variation || 0) + 1 });
}
