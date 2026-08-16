import { resolveXhsFormattingProfile } from './xhs-formatting.js';

const SOURCE_LEAK_PATTERNS = [
  /readme(?:\.md)?/gi, /根据(?:资料|文档|文件)/g, /根据(?:你|您)?(?:提供|上传)的(?:资料|文档|文件)/g,
  /基于(?:你|您)?(?:提供|上传)的(?:资料|文档|文件|内容)/g, /(?:你|您)(?:提供|上传)的(?:资料|文档|文件|内容)/g,
  /(?:资料|文档|文件)(?:显示|提到|中写道)/g, /(?:本地|文件)路径/g, /(?:内部)?文件名/g, /[a-zA-Z]:\\[^\s]+/g,
];

const AI_PHRASES = [
  '在当今快速发展的时代', '在当今时代', '随着科技的不断发展', '随着AI技术的发展', '值得一提的是', '从某种意义上来说',
  '总而言之，让我们', '这不仅是一款产品，更是一场革命', '未来已来', '让我们拭目以待', '共创美好未来',
  '赋能千行百业', '打造全新生态闭环', '希望这篇文章对你有所帮助', '你值得拥有更好的生活',
  '这个工具可能适合你', '值得一试', '了解一下', '它做的事情很简单', '不过要提醒一句', '不妨试试', '不妨考虑', '这篇文章或许能帮你',
  '可以考虑试试', '花在刀刃上', '或许值得你了解', '值得你了解',
];

const RISKY_CLAIMS = ['行业第一', '全网最好', '绝对安全', '百分之百', '100%有效', '唯一选择', '永久有效', '闭眼冲'];
const FAKE_EXPERIENCE = /(?:我|我们)[^。！？\n]{0,12}(?:亲测|实测|在用|用过|使用|用了|体验|试了|试用|测试|购买|踩过|发现)|(?:最近|这几天|前段时间|刚刚?)(?:我|我们)?[^。！？\n]{0,6}(?:亲测|实测|在用|用过|用了|体验|试了|试用|测试|购买|踩过|发现)|客户(?:都|纷纷|一致)(?:表示|反馈|认为)/g;
const NUMBERED_CLAIM = /(?:\d+(?:\.\d+)?(?:%|倍|万|亿元|万元|元|家|份|次|个|天|小时|分钟|秒)|[零〇二两三四五六七八九十百千万]+(?:%|倍|万|亿元|万元|元|家|份|次|个|天|小时|分钟|秒)|一(?:%|倍|万|亿元|万元|元|家|天|小时|分钟|秒))/g;
const XHS_PRODUCT_UNSUPPORTED_TERMS = [
  '海投', '海量', '手酸', '疲惫', '焦虑', '崩溃', '烦恼', '繁琐', '福音', '太累', '最烦', '大量', '省力', '提高效率', '更高效', '更顺畅',
  '投到烦', '怀疑人生', '可能会觉得', '守着电脑', '一遍遍', '只需要', '不用再手动', '不必在每个岗位', '更重要', '高效', '提高投递效率', '拖住', '花在刀刃上', '决定结果', '简历质量', '面试表现', '考虑试试', '值得你了解', '可能适合你', '打磨简历',
  '重新填写', '重复填写', '填写', '上传', '下载', '注册', '登录', '筛选', '点击', '刷新', '浏览', '打开招聘',
];
const XHS_NEUTRAL_FACT_REWRITES = [
  ['如果你正在向多个岗位重复提交简历，可能会觉得投递本身占用了不少时间', '如果你需要向多个岗位重复提交简历，就会面对重复投递操作'],
  ['你只需要先设置', '你先设置'],
  ['这样你就不用守着电脑一遍遍手动操作，可以把时间省下来，认真打磨简历、准备面试', '这样可以减少手动重复投递，把时间用于简历和面试准备'],
  ['你就不用再手动向多个岗位重复提交简历', '可以减少向多个岗位手动重复提交简历'],
  ['这能减少手动重复投递的操作，让你不必在每个岗位上都重复填写和提交', '这能减少手动重复投递操作，让你把时间用于简历和面试准备'],
  ['更重要的地方：打磨简历、准备面试', '简历和面试准备'],
  ['希望提高投递效率', '希望减少手动重复投递'],
  ['最终能否进入面试，还是取决于你的简历质量和面试表现', '你仍需要自行准备简历和面试'],
  ['才是决定结果的关键', '仍需要你自己准备'],
  ['经历海量投递的重复操作', '向多个岗位重复投递'],
  ['海量投递的重复操作', '向多个岗位重复投递'],
  ['海投到手酸', '向多个岗位重复投递'],
  ['海量投递', '多岗位投递'],
  ['海投', '向多个岗位投递'],
  ['大量时间', '时间'],
  ['大量精力', '精力'],
  ['烦恼', '重复操作'],
  ['繁琐', '重复'],
  ['提高效率', '减少重复操作'],
  ['更高效', '减少重复操作'],
  ['更顺畅', '减少重复操作'],
  ['省力', '减少重复操作'],
  ['可以考虑试试', '可以结合需求判断'],
  ['可能适合你', '可以判断是否适合自己的需求'],
  ['把时间花在刀刃上', '把时间用于简历和面试准备'],
];

export function stripSourceLeaks(text = '') {
  return SOURCE_LEAK_PATTERNS.reduce((value, pattern) => value.replace(pattern, ''), text)
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function countChineseLike(text = '') { return [...text.replace(/\s/g, '')].length; }

export function weightedTitleLength(text = '') {
  return [...text].reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0);
}

function truncateWeighted(text, max) {
  let output = ''; let total = 0;
  for (const char of text) {
    const weight = /[^\x00-\xff]/.test(char) ? 2 : 1;
    if (total + weight > max) break;
    output += char; total += weight;
  }
  return output.replace(/[，、：；\s]+$/, '').trim();
}

function allCopy(result) {
  return [...(result.titleCandidates || []), result.summary || '', result.bodyMarkdown || '', ...(result.topics || []), result.commentPrompt || '', ...(result.alternatives || [])].join('\n');
}

function validateSchema(result, spec) {
  const errors = [];
  for (const [field, rule] of Object.entries(spec.outputSchema || {})) {
    const value = result[field];
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    if (rule.required && empty) errors.push(`缺少必需字段：${field}`);
    const userRemovedXhsTopics = spec.id === 'xiaohongshu' && field === 'topics' && (result.removedTopics || []).length > 0;
    if (Array.isArray(value) && rule.minItems !== undefined && value.length < rule.minItems && !userRemovedXhsTopics) errors.push(`${field} 至少需要 ${rule.minItems} 项`);
    if (Array.isArray(value) && rule.maxItems !== undefined && value.length > rule.maxItems) errors.push(`${field} 最多允许 ${rule.maxItems} 项`);
    if (rule.enum && value != null && !rule.enum.includes(value)) errors.push(`${field} 不是允许的值`);
  }
  return errors;
}

const XHS_TOPIC_SIGNALS = [
  ['AI求职', /(?:AI|人工智能).{0,6}求职|求职.{0,6}(?:AI|人工智能)/i],
  ['简历投递', /简历.{0,6}投递|投递.{0,6}简历/],
  ['求职工具', /求职.{0,6}(?:工具|助手|产品)|(?:工具|助手|产品).{0,6}求职/],
  ['内容创作', /内容.{0,6}(?:创作|生成|生产)|(?:创作|生成).{0,6}内容/],
  ['营销文案', /营销.{0,6}文案|文案.{0,6}营销/],
  ['文案工具', /文案.{0,6}(?:工具|助手|平台)|(?:工具|助手|平台).{0,6}文案/],
  ['小红书运营', /小红书/],
  ['知乎创作', /知乎/],
  ['公众号运营', /公众号|微信公众号/],
  ['多平台创作', /多平台|多个平台|跨平台/],
  ['AI开发', /(?:AI|人工智能).{0,6}(?:开发|编程)|(?:开发|编程).{0,6}(?:AI|人工智能)/i],
  ['智能体', /智能体|\bagent\b/i],
  ['开源项目', /开源|\bopen source\b/i],
  ['自动化工具', /自动化.{0,6}(?:工具|平台|流程)|(?:工具|平台|流程).{0,6}自动化/],
  ['产品设计', /产品.{0,6}设计|设计.{0,6}产品/],
];

const CONTENT_TYPE_TOPIC_FALLBACKS = {
  product_marketing: ['产品介绍', '实用工具'],
  tutorial: ['实用教程', '操作指南'],
  opinion: ['观点分享', '行业观察'],
  personal_story: ['经验分享', '个人成长'],
  case_study: ['案例分析', '实践复盘'],
  event_announcement: ['活动资讯', '活动分享'],
  release_update: ['产品更新', '功能上新'],
  brand_story: ['品牌故事', '产品理念'],
  general_article: ['内容分享', '实用方法'],
};

function completeXhsTopics(result, context = {}) {
  const removed = new Set([...(result.removedTopics || []), ...(context.removedTopics || [])].map((topic) => String(topic).replace(/^#+/, '').trim()).filter(Boolean));
  const current = [...new Set((result.topics || []).map((topic) => String(topic).replace(/^#+/, '').trim()).filter((topic) => topic && !removed.has(topic)))];
  if (current.length >= 3) return { ...result, topics: current.slice(0, 8) };
  if (removed.size) return { ...result, topics: current, removedTopics: [...removed] };

  const taskBrief = context.taskBrief || {};
  const facts = context.factSet?.verifiedFacts || taskBrief.facts || [];
  const subjectName = String(taskBrief.subject?.name || '').trim();
  const searchable = [subjectName, taskBrief.subject?.description, ...facts.map((fact) => fact.statement), ...(result.titleCandidates || []), result.bodyMarkdown]
    .filter(Boolean).join('\n');
  const suggested = [...current];
  if (subjectName && subjectName.length <= 24 && !/^(?:产品|工具|内容|主题|这款产品)$/.test(subjectName)) suggested.push(subjectName);
  for (const [topic, pattern] of XHS_TOPIC_SIGNALS) if (pattern.test(searchable)) suggested.push(topic);
  suggested.push(...(CONTENT_TYPE_TOPIC_FALLBACKS[taskBrief.contentType] || CONTENT_TYPE_TOPIC_FALLBACKS.general_article));
  suggested.push('内容分享');
  return { ...result, topics: [...new Set(suggested)].filter((topic) => !removed.has(topic)).slice(0, 8), topicsAutoCompleted: true };
}

export function repairMissingPlatformFields(result, spec, context = {}) {
  return spec.id === 'xiaohongshu' ? completeXhsTopics(result, context) : result;
}

function unsupportedNumbers(text, factSet) {
  const knownValues = factSet.knownNumbers?.length
    ? factSet.knownNumbers
    : factSet.verifiedFacts?.flatMap((fact) => fact.statement.match(NUMBERED_CLAIM) || []) || [];
  const known = new Set(knownValues);
  return [...new Set(text.match(NUMBERED_CLAIM) || [])].filter((value) => !known.has(value));
}

function unsupportedScenarioClaims(text, factSet, result, spec) {
  if (spec.id !== 'xiaohongshu' || result.strategySnapshot?.contentType !== 'product_marketing') return [];
  const evidence = (factSet.verifiedFacts || []).map((fact) => fact.statement).join('\n');
  const checks = [
    { pattern: /每天[^。！？\n]{0,40}/g, evidence: /每天/ },
    { pattern: /大量(?:时间|精力)/g, evidence: /大量(?:时间|精力)/ },
    { pattern: /(?:投|写|改)[^。！？\n]{0,14}(?:手酸|崩溃|累哭|累死)/g, evidence: /手酸|崩溃|累哭|累死/ },
    { pattern: /(?:作用是|可以|能够|能|帮助|帮你)[^。！？\n]{0,12}扩大[^。！？\n]{0,8}投递范围/g, evidence: /(?:作用是|可以|能够|能|帮助|帮你)[^。！？\n]{0,12}扩大[^。！？\n]{0,8}投递范围/ },
  ];
  const termIssues = XHS_PRODUCT_UNSUPPORTED_TERMS.filter((term) => text.includes(term) && !evidence.includes(term));
  return [...checks.flatMap(({ pattern, evidence: evidencePattern }) => evidencePattern.test(evidence) ? [] : text.match(pattern) || []), ...termIssues];
}

function removeUnsafeSentences(text, unsafeTerms) {
  return text.split(/\n+/).map((paragraph) => {
    const sentences = paragraph.match(/[^。！？!?]+[。！？!?]?/g) || [];
    return sentences.filter((sentence) => !unsafeTerms.some((term) => sentence.includes(term))).join('').trim();
  }).filter(Boolean).join('\n\n');
}

export function enforceProductFactLanguage(result, spec, factSet = { verifiedFacts: [] }, contentType = '', extendLength = false) {
  if (spec.id !== 'xiaohongshu' || contentType !== 'product_marketing') return result;
  const evidence = (factSet.verifiedFacts || []).map((fact) => fact.statement).join('\n');
  const unsupported = XHS_PRODUCT_UNSUPPORTED_TERMS.filter((term) => !evidence.includes(term));
  const rewrite = (value = '') => {
    let output = String(value);
    for (const [phrase, replacement] of XHS_NEUTRAL_FACT_REWRITES) {
      if (!evidence.includes(phrase)) output = output.replaceAll(phrase, replacement);
    }
    output = output.replace(/([A-Za-z0-9\u4e00-\u9fa5_-]{2,24})\s*或许值得你了解/g, '可以结合自己的需求判断 $1 是否适合');
    output = output.replace(/([A-Za-z0-9\u4e00-\u9fa5_-]{2,24})\s*的作用是帮你扩大投递范围，而不是替代你的准备/g, '$1 处理的是投递环节，不替代简历和面试准备');
    const remaining = unsupported.filter((term) => output.includes(term));
    return remaining.length ? removeUnsafeSentences(output, remaining) : output;
  };

  const repaired = {
    ...result,
    titleCandidates: (result.titleCandidates || []).filter((title) => !unsupported.some((term) => title.includes(term))).map(rewrite).filter(Boolean),
    summary: result.summary == null ? null : rewrite(result.summary),
    bodyMarkdown: makeNatural(rewrite(result.bodyMarkdown)),
    topics: (result.topics || []).map(rewrite).filter(Boolean),
    commentPrompt: result.commentPrompt == null ? null : rewrite(result.commentPrompt),
    alternatives: (result.alternatives || []).map(rewrite).filter(Boolean),
  };
  const statements = factSet.verifiedFacts.map((fact) => fact.statement.replace(/[。！？]+$/, ''));
  const findValue = (pattern) => statements.map((statement) => statement.match(pattern)?.[1]?.trim()).find(Boolean);
  const name = findValue(/^产品名是\s*(.+)$/) || '这款产品';
  const safeTitles = [
    `${name}：先看适用需求和能力边界`,
    `什么情况适合使用 ${name}`,
    `${name}解决的是哪一部分任务`,
    `使用 ${name} 前需要确认什么`,
    `${name}的作用和边界`,
  ];
  if (repaired.titleCandidates.length < 3) repaired.titleCandidates = [...new Set([...repaired.titleCandidates, ...safeTitles])].slice(0, 5);
  if (!extendLength || factSet.verifiedFacts?.length < 4 || countChineseLike(repaired.bodyMarkdown) >= 320) return repaired;

  const audience = findValue(/^目标用户是\s*(.+)$/);
  const need = findValue(/^目标用户需要\s*(.+)$/);
  const value = findValue(/^产品价值是\s*(.+)$/);
  const workflow = statements.find((statement) => /(?:用户先|使用时|先设置|先选择).*(?:根据|随后|然后|自动)/.test(statement));
  const boundary = statements.find((statement) => /不保证|仍需要|不包含|不支持|限制|边界/.test(statement));
  const additions = [];
  if (audience && need) additions.push(`判断是否适合 ${name}，可以先对照两点：你是否属于${audience}；你是否也需要${need}。如果这两项都符合，再判断这项能力是否对应你的实际任务。`);
  if (workflow && boundary) additions.push(`具体使用方式和边界需要一起看：${workflow}。同时，${boundary}。`);
  if (value && boundary) additions.push(`从产品作用看，${value}。判断时也要把能力和边界放在一起：确认它是否对应当前任务，同时确认自己是否接受“${boundary}”这一限制。`);
  for (const addition of additions) {
    if (countChineseLike(repaired.bodyMarkdown) >= 320) break;
    repaired.bodyMarkdown = `${repaired.bodyMarkdown}\n\n${addition}`;
  }
  return repaired;
}

function paragraphList(text = '') {
  return text.split(/\n+/).map((part) => part.replace(/^[-*]\s+/, '').trim()).filter(Boolean);
}

function titleBigrams(text = '') {
  const compact = [...text.replace(/[\s，。！？、：；,.!?:;《》“”"']/g, '')];
  return new Set(compact.slice(0, -1).map((char, index) => `${char}${compact[index + 1]}`));
}

function similarity(left, right) {
  const a = titleBigrams(left); const b = titleBigrams(right);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((item) => b.has(item)).length;
  return overlap / new Set([...a, ...b]).size;
}

function emojiCount(text = '') { return (text.match(/[\p{Extended_Pictographic}]/gu) || []).length; }

function splitXhsParagraph(paragraph, profile) {
  const maxCharacters = profile.paragraphPolicy.maxContinuousCharacters;
  const maxSentences = profile.paragraphPolicy.sentencesPerParagraph[1];
  if (countChineseLike(paragraph) <= maxCharacters && (paragraph.match(/[。！？!?]/g) || []).length <= maxSentences) return [paragraph];
  const sentences = paragraph.match(/[^。！？!?]+[。！？!?]?/g)?.map((item) => item.trim()).filter(Boolean) || [paragraph];
  const groups = [];
  let current = '';
  let sentenceCount = 0;
  for (const sentence of sentences) {
    const wouldOverflow = current && (countChineseLike(current + sentence) > maxCharacters || sentenceCount >= maxSentences);
    if (wouldOverflow) {
      groups.push(current);
      current = '';
      sentenceCount = 0;
    }
    current += sentence;
    sentenceCount += 1;
  }
  if (current) groups.push(current);
  return groups;
}

function semanticEmojiForParagraph(paragraph, index, total) {
  if (/(?:不能|必须|注意|边界|需要你确认|但也|但要)/.test(paragraph)) return '⚠️';
  if (/(?:适合|面向|开发者|团队|人群)/.test(paragraph)) return '👥';
  if (index === total - 1 && /(?:试试|开始|参与|报名|判断是否适合)/.test(paragraph)) return '👉';
  if (/(?:支持|可以|能够|会|功能|核心|作用|产品)/.test(paragraph)) return '💡';
  return index > 0 ? '💡' : null;
}

export function repairXhsBodyFormatting(bodyMarkdown = '', profile) {
  if (!profile || !bodyMarkdown.trim()) return bodyMarkdown;
  const paragraphs = bodyMarkdown.split(/\n+/).map((item) => item.trim()).filter(Boolean)
    .flatMap((paragraph) => splitXhsParagraph(paragraph, profile));
  const targetMin = Math.min(profile.emojiPolicy.recommendedMin || 0, profile.emojiPolicy.maxCount || 0);
  let missing = Math.max(0, targetMin - emojiCount(paragraphs.join('\n')));
  if (missing > 0) {
    const candidates = paragraphs.map((paragraph, index) => ({ index, emoji: semanticEmojiForParagraph(paragraph, index, paragraphs.length) }))
      .filter((item) => item.emoji);
    const used = new Set();
    for (const candidate of candidates) {
      if (!missing) break;
      const key = `${candidate.emoji}:${candidate.index}`;
      if (used.has(key) || emojiCount(paragraphs[candidate.index])) continue;
      paragraphs[candidate.index] = `${candidate.emoji} ${paragraphs[candidate.index]}`;
      used.add(key);
      missing -= 1;
    }
  }
  return paragraphs.join('\n\n');
}

function xhsFormattingChecks(result, profile) {
  const paragraphs = paragraphList(result.bodyMarkdown);
  const titles = result.titleCandidates || [];
  const combined = allCopy(result);
  const bodyEmojiTotal = emojiCount(result.bodyMarkdown || '');
  const emojiTotal = emojiCount(combined);
  const overlongParagraphs = paragraphs.filter((paragraph) => countChineseLike(paragraph) > profile.paragraphPolicy.maxContinuousCharacters || (paragraph.match(/[。！？!?]/g) || []).length > profile.paragraphPolicy.sentencesPerParagraph[1]);
  const repeatedEmoji = /(?:[\p{Extended_Pictographic}\uFE0F]\s*){3,}/gu.test(combined);
  const markdownLayout = /^(?:#{1,6}\s|\*\*.+\*\*$)/m.test(result.bodyMarkdown || '');
  const titleEmojiOverflow = titles.some((title) => emojiCount(title) > 1);
  const topicIntentOverlap = (result.topics || []).some((topic, index, topics) => topics.slice(index + 1).some((other) => similarity(topic, other) > 0.72));
  const ctaSignals = (result.bodyMarkdown.match(/(?:点赞|收藏|关注|评论|私信|购买|报名|立即|赶紧)/g) || []).length;
  return {
    emojiCount: bodyEmojiTotal >= (profile.emojiPolicy.recommendedMin || 0) && emojiTotal <= profile.emojiPolicy.maxCount && !repeatedEmoji && !titleEmojiOverflow ? 'pass' : 'warning',
    emojiSequence: repeatedEmoji ? 'warning' : 'pass',
    paragraphScanability: overlongParagraphs.length ? 'warning' : 'pass',
    paragraphRhythm: paragraphs.length >= 3 && new Set(paragraphs.map((paragraph) => Math.round(countChineseLike(paragraph) / 20))).size === 1 ? 'warning' : 'pass',
    markdownLayout: markdownLayout ? 'warning' : 'pass',
    ctaAlignment: ctaSignals <= 2 ? 'pass' : 'warning',
    topicCount: (result.topics || []).length <= 8 && ((result.topics || []).length >= 3 || (result.removedTopics || []).length > 0) ? 'pass' : 'warning',
    topicDiversity: topicIntentOverlap ? 'warning' : 'pass',
    details: { emojiTotal, bodyEmojiTotal, overlongParagraphCount: overlongParagraphs.length, repeatedEmoji, titleEmojiOverflow, markdownLayout, ctaSignals, topicIntentOverlap },
  };
}

function platformWarnings(result, spec, bodyLength, context = {}) {
  const warnings = [];
  if (spec.id !== 'xiaohongshu' && bodyLength < spec.recommended.min) warnings.push(`正文较短，${spec.label}推荐 ${spec.recommended.min}-${spec.recommended.max} 字；资料较少时请补充事实，不要用空话凑字数`);
  if (spec.id !== 'xiaohongshu' && bodyLength > spec.recommended.max) warnings.push(`正文较长，${spec.label}推荐 ${spec.recommended.min}-${spec.recommended.max} 字`);
  if (spec.id === 'xiaohongshu') {
    const paragraphs = paragraphList(result.bodyMarkdown);
    const titles = result.titleCandidates || [];
    const profile = context.formattingProfile || resolveXhsFormattingProfile({ taskBrief: context.taskBrief || { contentType: result.strategySnapshot?.contentType || 'general_article', facts: [] }, strategy: context.strategy || result.strategySnapshot || {}, userOverride: result.formattingOverride || {} });
    const checks = xhsFormattingChecks(result, profile);
    const { bodyMin, bodyMax } = profile.lengthTarget;
    if (bodyLength < bodyMin) warnings.push(`当前资料量建议正文为 ${bodyMin}-${bodyMax} 字；可以保持短版，不要用空话补长度`);
    if (bodyLength > bodyMax) warnings.push(`当前资料量建议正文为 ${bodyMin}-${bodyMax} 字，可优先删除重复信息`);
    if ((result.titleCandidates || []).some((title) => weightedTitleLength(title) > 38)) warnings.push('小红书标题加权长度不能超过 38');
    if ((result.topics || []).length < 3 && !(result.removedTopics || []).length) warnings.push('小红书建议提供 3-8 个直接相关的话题');
    if (checks.emojiCount !== 'pass') warnings.push(`Emoji 需要符合“${profile.platformFeelLabel}”的排版策略，正文使用 ${profile.emojiPolicy.recommendedMin}-${profile.emojiPolicy.maxCount} 个语义锚点且不能连续堆叠`);
    if (checks.paragraphScanability !== 'pass') warnings.push(`小红书正文存在过长段落，连续文本通常不超过 ${profile.paragraphPolicy.maxContinuousCharacters} 字且每段 1-3 句`);
    if (checks.paragraphRhythm !== 'pass') warnings.push('正文段落长度过于整齐，建议打散机械节奏');
    if (checks.markdownLayout !== 'pass') warnings.push('小红书正文不使用 Markdown 标题或整段加粗模拟排版');
    if (checks.ctaAlignment !== 'pass') warnings.push('正文包含多个行动要求，只保留一个与目标一致的行动');
    if (checks.topicDiversity !== 'pass') warnings.push('话题中存在意思过近的标签，需要分层并去重');
    if (paragraphs.length < 3) warnings.push('小红书正文建议拆成至少 3 个有信息的短段落，方便手机阅读');
    if (paragraphs.slice(0, 2).join('').length < 50) warnings.push('前两段还没有完整建立场景、问题或阅读理由');
    if (result.strategySnapshot?.contentType === 'product_marketing') {
      if (!/(?:适合|面向|如果你|用于|需要.{0,12}(?:人|用户|团队|创作者|求职者))/.test(result.bodyMarkdown || '')) warnings.push('产品内容需要说明适合谁，不能只介绍功能');
      if (/^(?:#*\s*)?[A-Za-z0-9\u4e00-\u9fa5_-]{2,24}\s*(?:是|是一款|可以|支持|主打)/.test(paragraphs[0] || '')) warnings.push('产品营销不应从品牌自我介绍开场，应先建立用户问题或场景');
      if (/^(?:我们做|我们推出).{0,24}(?:就是)?为了解决(?:这个|这一)问题/.test(paragraphs[0] || '')) warnings.push('开头使用了没有前文指向的“这个问题”，需要直接说明具体任务');
      if (/(?:这个|这款).{0,12}(?:工具|产品).{0,8}(?:可能)?适合你|(?:值得一试|了解一下|值得你了解)[。！!]?$/m.test(result.bodyMarkdown || '')) warnings.push('产品文案使用了第三方旁观推荐式表达，应改成产品方面向用户的直接说明');
    }
    for (let i = 0; i < titles.length; i += 1) {
      for (let j = i + 1; j < titles.length; j += 1) {
        if (similarity(titles[i], titles[j]) > 0.72) {
          warnings.push('小红书标题候选角度过于相似，不能只替换同义词');
          i = titles.length; break;
        }
      }
    }
  }
  if (spec.id === 'wechat') {
    if (!result.summary) warnings.push('缺少公众号摘要');
    if (result.summary && countChineseLike(result.summary) > 128) warnings.push('公众号摘要超过 128 字');
    if (result.summary && result.bodyMarkdown?.replace(/^#+\s+.*\n+/, '').trim().startsWith(result.summary.trim())) warnings.push('公众号摘要不应复制正文开头');
    if (/\{embed:|\]\(placeholder\)|<\/?[a-z][^>]*>/i.test(result.bodyMarkdown || '')) warnings.push('纯文案结果不应包含发布占位符或 HTML');
  }
  if (spec.id === 'zhihu') {
    if (spec.mode === 'answer' && !result.questionTitle) warnings.push('知乎回答缺少问题标题');
    if (!/(限制|边界|适合|不适合|条件|取决于|例外|前提)/.test(result.bodyMarkdown || '')) warnings.push('知乎内容建议补充适用边界、条件或反例');
  }
  if (spec.id === 'generic' && ((result.topics || []).length || /#[^#\s]+/.test(result.bodyMarkdown || ''))) warnings.push('通用文案不应自动添加平台话题');
  return warnings;
}

export function runQualityChecks(result, spec, factSet = { verifiedFacts: [], conflicts: [], knownNumbers: [] }, context = {}) {
  const combined = allCopy(result);
  const sourceLeaks = SOURCE_LEAK_PATTERNS.flatMap((pattern) => combined.match(pattern) || []);
  const aiPhrases = AI_PHRASES.filter((phrase) => combined.includes(phrase));
  const notButCount = (combined.match(/不是[^。！？\n]{1,30}(?:而是|是)/g) || []).length;
  if (notButCount >= 3) aiPhrases.push('“不是 X，而是 Y”句式重复');
  if (/(?:首先)[\s\S]{0,400}(?:其次)[\s\S]{0,400}(?:最后)/.test(combined)) aiPhrases.push('机械的首先/其次/最后结构');
  const riskyClaims = RISKY_CLAIMS.filter((claim) => combined.includes(claim));
  const unsupported = unsupportedNumbers(combined, factSet);
  const unsupportedScenarios = unsupportedScenarioClaims(combined, factSet, result, spec);
  const experienceClaims = combined.match(FAKE_EXPERIENCE) || [];
  const hasExperienceEvidence = Boolean(factSet.experiences?.length) || factSet.verifiedFacts?.some((fact) => /(?:我|我们).{0,20}(使用|测试|经历|购买|体验)/.test(fact.statement));
  const bodyLength = countChineseLike(result.bodyMarkdown || '');
  const schemaErrors = validateSchema(result, spec);
  const platformIssues = platformWarnings(result, spec, bodyLength, context);
  const formattingProfile = spec.id === 'xiaohongshu'
    ? context.formattingProfile || resolveXhsFormattingProfile({ taskBrief: context.taskBrief || { contentType: result.strategySnapshot?.contentType || 'general_article', facts: factSet.verifiedFacts || [] }, strategy: context.strategy || result.strategySnapshot || {}, userOverride: result.formattingOverride || {} })
    : null;
  const formattingChecks = formattingProfile ? xhsFormattingChecks(result, formattingProfile) : null;
  const blockingErrors = [
    ...sourceLeaks.map((item) => `发现内部来源表述：${item}`),
    ...riskyClaims.map((item) => `发现需要证据的绝对表述：${item}`),
    ...unsupported.map((item) => `发现资料未支持的数字声明：${item}`),
    ...unsupportedScenarios.map((item) => `发现资料未支持的具体场景：${item}`),
    ...(!hasExperienceEvidence ? experienceClaims.map((item) => `发现没有真实依据的经历表达：${item}`) : []),
    ...schemaErrors,
  ];
  const warnings = [...aiPhrases.map((item) => `发现模板化表达：${item}`), ...platformIssues];
  const status = blockingErrors.length ? 'blocked' : warnings.length ? 'ready_with_warnings' : 'ready';
  return {
    status,
    factCheck: factSet.conflicts?.length || unsupported.length || unsupportedScenarios.length || (!hasExperienceEvidence && experienceClaims.length) ? 'fail' : 'pass',
    sourceLeakCheck: sourceLeaks.length ? 'fail' : 'pass',
    platformCheck: schemaErrors.length ? 'fail' : platformIssues.length ? 'warning' : 'pass',
    aiStyleCheck: aiPhrases.length ? 'warning' : 'pass',
    riskCheck: riskyClaims.length ? 'fail' : 'pass',
    logicCheck: unsupported.length ? 'fail' : 'pass',
    bodyLength,
    formattingChecks,
    blockingErrors,
    warnings: [...blockingErrors, ...warnings],
    suggestions: warnings,
    autoRepairIssues: [
      ...sourceLeaks.map((item) => `删除内部来源表述：${item}`),
      ...unsupported.map((item) => `删除或改写资料未支持的数字/数量声明：${item}`),
      ...unsupportedScenarios.map((item) => `删除或改成不虚构具体状态的条件表达：${item}`),
      ...(!hasExperienceEvidence ? experienceClaims.map((item) => `删除没有真实依据的经历表达：${item}`) : []),
      ...aiPhrases.map((item) => `移除模板化表达：${item}`),
      ...platformIssues,
    ],
  };
}

export function makeNatural(text = '') {
  let output = text;
  const semanticReplacements = new Map([
    ['这个工具可能适合你', '可以先判断它是否适合你的需求'],
    ['值得一试', '可以结合需求判断'],
    ['了解一下', '进一步了解'],
    ['它做的事情很简单', '它的核心能力很明确'],
    ['不过要提醒一句', '需要说明的是'],
    ['不妨试试', '可以尝试'],
    ['不妨考虑', '可以判断'],
    ['这篇文章或许能帮你', '下面的信息可以帮助你'],
  ]);
  for (const phrase of AI_PHRASES) output = output.replaceAll(phrase, semanticReplacements.get(phrase) || '');
  return stripSourceLeaks(output.replace(/(?:首先|其次|此外|最后)，?/g, '').replace(/赋能/g, '帮助').replace(/打造/g, '建立')
    .replace(/生态闭环/g, '完整流程').replace(/！{2,}/g, '！').replace(/\n{3,}/g, '\n\n').replace(/^[，。；、 \t]+/gm, '').trim());
}

export function normalizeAndRepairResult(result, spec, context = {}) {
  let repaired = {
    ...result,
    titleCandidates: [...new Set((result.titleCandidates || []).map((value) => stripSourceLeaks(String(value)).trim()).filter(Boolean))],
    summary: result.summary == null ? null : stripSourceLeaks(String(result.summary)),
    bodyMarkdown: stripSourceLeaks(String(result.bodyMarkdown || '')),
    topics: [...new Set((result.topics || []).map((value) => stripSourceLeaks(String(value)).replace(/^#/, '').trim()).filter(Boolean))],
    alternatives: [...new Set((result.alternatives || []).map((value) => stripSourceLeaks(String(value)).trim()).filter(Boolean))],
  };
  if (spec.id === 'xiaohongshu') {
    repaired.titleCandidates = repaired.titleCandidates.slice(0, 5).map((title) => truncateWeighted(title, 38));
    repaired.topics = repaired.topics.slice(0, 8);
    repaired.removedTopics = [...new Set((repaired.removedTopics || context.removedTopics || []).map((value) => String(value).replace(/^#/, '').trim()).filter(Boolean))];
    repaired.topics = repaired.topics.filter((topic) => !repaired.removedTopics.includes(topic));
    repaired = repairMissingPlatformFields(repaired, spec, context);
  } else if (spec.id === 'zhihu') {
    repaired.titleCandidates = spec.mode === 'answer' ? [] : repaired.titleCandidates.slice(0, 3);
    repaired.topics = repaired.topics.slice(0, 5);
    repaired.mode = spec.mode;
  } else if (spec.id === 'wechat') {
    repaired.titleCandidates = repaired.titleCandidates.slice(0, 5);
    if (repaired.summary && countChineseLike(repaired.summary) > 128) repaired.summary = [...repaired.summary].slice(0, 128).join('').replace(/[，、：；\s]+$/, '');
    const bodyOpening = repaired.bodyMarkdown.replace(/^#+\s+.*\n+/, '').trim();
    if (repaired.summary && bodyOpening.startsWith(repaired.summary.trim())) {
      const subject = repaired.titleCandidates[0] || '本期主题';
      repaired.summary = `这篇内容围绕“${subject}”展开，重点说明相关任务、可核对的信息和适用边界，帮助读者结合自己的情况作出判断。`;
    }
    repaired.topics = [];
  } else if (spec.id === 'generic') {
    repaired.titleCandidates = [];
    repaired.topics = [];
  }
  repaired.bodyMarkdown = makeNatural(repaired.bodyMarkdown);
  if (spec.id === 'xiaohongshu' && context.applyFormattingRepair) repaired.bodyMarkdown = repairXhsBodyFormatting(repaired.bodyMarkdown, context.formattingProfile);
  return repaired;
}
