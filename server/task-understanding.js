import crypto from 'node:crypto';
import { inferPlatformMode, normalizePlatform } from './platform-specs.js';
import { recommendStrategies } from './strategy-engine.js';

const SENTENCE_SPLIT = /(?<=[。！？!?；;\n])\s*/;
const VAGUE_REQUESTS = [
  /^帮我(?:宣传|推广|写|介绍)一下[。！!？?]?$/,
  /^写(?:一篇|一个|点)?文案[。！!？?]?$/,
  /^写(?:一篇|一个)?(?:产品介绍|活动推广文案|知乎回答|公众号文章)[。！!？?]?$/,
  /^帮我弄一下/,
];

export function cleanMaterialText(text = '') {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/^#{1,6}\s+/gm, '').replace(/\[(.*?)\]\([^)]*\)/g, '$1')
    .replace(/(?:README(?:\.md)?|本地路径|文件路径)/gi, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function originFor(sourceId) { return sourceId === 'user_instruction' ? 'user_provided' : 'source_fact'; }

export function buildFactSet({ instruction = '', materials = [] }) {
  const entries = []; const opinions = []; const experiences = []; const seen = new Set();
  const addText = (text, sourceId, displayName = '用户提供的信息') => {
    cleanMaterialText(text).split(SENTENCE_SPLIT).forEach((part) => {
      const statement = part.trim().replace(/^[-*\d.、\s]+/, '');
      if (statement.length < 8 || statement.length > 500 || /^(帮我|请|写一篇|改成|不要|需要写)/.test(statement)) return;
      if (/(?:内部)?文件名|资料来源|本地路径|文件路径|提示词|生成过程|只用于理解|不应出现在对外/i.test(statement)) return;
      const key = statement.toLowerCase(); if (seen.has(key)) return; seen.add(key);
      const common = { statement, evidence: statement, sourceId, displayName, origin: originFor(sourceId), confidence: 1 };
      if (/(?:我|我们)(?:曾经|已经|亲自|实际)?[^。！？\n]{0,24}(?:使用|测试|体验|购买|做过|经历)/.test(statement)) {
        const experienceId = `experience_${String(experiences.length + 1).padStart(3, '0')}`;
        experiences.push({ ...common, experienceId, factId: experienceId });
      } else if (/(?:我认为|我觉得|我的观点|建议|可能|或许|推测|应该|值得考虑)/.test(statement)) {
        opinions.push({ ...common, opinionId: `opinion_${String(opinions.length + 1).padStart(3, '0')}` });
      } else {
        entries.push({ ...common, factId: `fact_${String(entries.length + 1).padStart(3, '0')}` });
      }
    });
  };
  materials.forEach((material, index) => addText(material.text || '', material.id || `source_${index + 1}`, material.displayName || '用户提供的资料'));
  if (!entries.length && instruction.length > 20) addText(instruction, 'user_instruction', '用户指令');
  const allText = [...entries, ...experiences].map((entry) => entry.statement).join(' ');
  const numbers = [...new Set(allText.match(/\d+(?:\.\d+)?(?:%|倍|万|元|天|小时|分钟)?/g) || [])];
  return {
    verifiedFacts: entries.slice(0, 80), facts: entries.slice(0, 80), opinions: opinions.slice(0, 30), experiences: experiences.slice(0, 30), unknowns: [],
    claimsRequiringConfirmation: [], conflicts: [], knownNumbers: numbers,
    sourceMetadata: materials.map((material, index) => ({ sourceId: material.id || `source_${index + 1}`, displayName: material.kind === 'url' ? '用户提供的网页' : '用户提供的资料', externalizable: false })),
  };
}

export function classifyContentType(instruction = '') {
  if (/活动|报名|优惠|促销|发布会/.test(instruction)) return 'event_announcement';
  if (/教程|操作指南|操作方法|使用步骤|怎么用|如何使用/.test(instruction)) return 'tutorial';
  if (/产品名|产品介绍|产品营销|推广|宣传|种草|卖点|转化/.test(instruction)) return 'product_marketing';
  if (/步骤|怎么|如何|指南|操作/.test(instruction)) return 'tutorial';
  if (/观点|认为|为什么|看法|分析/.test(instruction)) return 'opinion';
  if (/复盘|案例|项目经历/.test(instruction)) return 'case_study';
  if (/更新|版本|发布说明|新功能/.test(instruction)) return 'release_update';
  if (/品牌故事|品牌介绍|创立|起源/.test(instruction)) return 'brand_story';
  if (/产品|营销/.test(instruction)) return 'product_marketing';
  return 'general_article';
}

function extractQuestionTitle(instruction) {
  const quoted = instruction.match(/(?:问题|回答)[：:]?[「“\"]([^」”\"]+[？?])/)?.[1];
  if (quoted) return quoted.trim();
  const question = instruction.match(/([^。！!\n]{5,80}[？?])/ )?.[1];
  return question?.replace(/^(?:请|帮我)?(?:回答)?/, '').trim() || null;
}

function extractSubject(instruction, facts) {
  const explicit = instruction.match(/(?:产品名|名称|主题)(?:是|为|叫|：|:)\s*([A-Za-z0-9\u4e00-\u9fa5_-]{2,40})/)?.[1];
  if (explicit) return explicit;
  const first = facts[0]?.statement || instruction;
  return first.replace(/^(?:请|帮我|根据|写一篇|写一个)/, '').replace(/[。！？\n].*$/, '').slice(0, 42) || '未命名主题';
}

function inferPurpose(instruction, contentType) {
  if (/摘要/.test(instruction)) return 'summary';
  if (/润色|改写|改自然/.test(instruction)) return 'rewrite';
  if (/通知/.test(instruction)) return 'announcement';
  if (/官网/.test(instruction)) return 'website_copy';
  if (/销售|私域|社群/.test(instruction)) return 'sales_support';
  return contentType === 'product_marketing' ? 'product_intro' : 'general_copy';
}

function extractUnsupportedQuantifiedClaims(instruction, factSet) {
  const patterns = [
    /(?:提升|增长|降低|节省|用户数|销售额|转化率|性能)[^。！？!?\n]{0,24}?\d+(?:\.\d+)?(?:%|倍|万|元|天|小时|分钟)?/g,
    /\d+(?:\.\d+)?(?:%|倍|万|元|天|小时|分钟)?[^。！？!?\n]{0,10}?(?:提升|增长|降低|节省|用户数|销售额|转化率|性能)/g,
  ];
  const claims = patterns.flatMap((pattern) => [...instruction.matchAll(pattern)]).filter((match) => {
    const prefix = instruction.slice(Math.max(0, match.index - 16), match.index);
    return !/(?:不要|别|禁止|避免|不应|不得|无需|不含|不虚构)[^。！？!?\n]{0,12}$/.test(prefix);
  }).map((match) => match[0].trim());
  return [...new Set(claims)].filter((claim) => !factSet.knownNumbers.some((number) => claim.includes(number)));
}

function extractConstraints(instruction, factSet) {
  const mustAvoid = [];
  if (/不要营销|减少营销|不.*营销腔/.test(instruction)) mustAvoid.push('强营销口吻');
  if (/不要.*第一人称|不.*亲测|不.*体验/.test(instruction)) mustAvoid.push('第一人称体验');
  if (/不要.*数据|不.*数字/.test(instruction)) mustAvoid.push('未经要求的数字');
  const unsupportedClaims = extractUnsupportedQuantifiedClaims(instruction, factSet);
  return { mustInclude: [], mustAvoid, unsupportedClaims };
}

export function assessRequest({ instruction = '', factSet, platform = 'xiaohongshu', platformMode = null, taskBrief = null }) {
  const text = instruction.trim(); const questions = [];
  if (!text) return { enough: false, questions: ['你想写什么内容？可以告诉我主题、用途，或直接添加资料。'] };
  if (VAGUE_REQUESTS.some((pattern) => pattern.test(text)) && !factSet.verifiedFacts.length) questions.push('要宣传或介绍什么？请提供名称和至少一条关键信息。');
  if (extractUnsupportedQuantifiedClaims(text, factSet).length) questions.push('你要写入具体数据，但它还没有被作为产品信息提供。请确认这个数据，或者我可以自动改成不带数字的价值表达。');
  const requestsExperience = /(?:请|要|用|改成|写成).{0,8}(?:亲测|我的经历|我用了|第一人称)|(?:亲测|我的经历|我用了|第一人称).{0,8}(?:来写|表达|口吻)/.test(text)
    && !/(?:不要|别|禁止|避免|不使用).{0,8}(?:亲测|我的经历|第一人称)/.test(text);
  if (requestsExperience && !/(我|我们).{0,20}(使用|测试|经历|做过)/.test(factSet.verifiedFacts.map((fact) => fact.statement).join(''))) questions.push('你希望使用第一人称经历。请提供真实经历，或确认改成客观介绍。');
  const normalizedPlatform = normalizePlatform(platform);
  const mode = inferPlatformMode(normalizedPlatform, text, platformMode);
  const contentType = taskBrief?.contentType || classifyContentType(text);
  if (normalizedPlatform === 'xiaohongshu' && contentType === 'product_marketing') {
    const productFactUnits = (factSet.verifiedFacts || [])
      .flatMap((fact) => fact.statement.split(/[，,、；;。！？!?\n]+/))
      .map((part) => part.trim())
      .filter((part) => part.length >= 6);
    const hasUsableDescription = productFactUnits.some((part) => /(?:是|支持|提供|可以|能够|用于|面向|解决|帮助|允许|包含|具备)/.test(part)
      && !/^(?:产品名|名称)(?:是|为|叫|：|:)/.test(part));
    if (!hasUsableDescription) {
      questions.push('再告诉我一句这个产品是什么或能做什么，我就可以先按现有信息生成宣传文案。');
    }
  }
  if (normalizedPlatform === 'zhihu' && mode === 'answer' && !(taskBrief?.questionTitle || extractQuestionTitle(text))) questions.push('这是知乎回答，但还没有具体问题。请提供问题标题，或改成知乎文章。');
  return { enough: questions.length === 0, questions: [...new Set(questions)].slice(0, 2) };
}

export function createTaskBrief({ instruction = '', platform = 'xiaohongshu', platformMode = null, tone = '自然、专业', materials = [], factSet = null }) {
  const facts = factSet || buildFactSet({ instruction, materials });
  const normalizedPlatform = normalizePlatform(platform);
  const mode = inferPlatformMode(normalizedPlatform, instruction, platformMode);
  const contentType = classifyContentType(instruction);
  const subjectName = extractSubject(instruction, facts.verifiedFacts);
  const questionTitle = normalizedPlatform === 'zhihu' && mode === 'answer' ? extractQuestionTitle(instruction) : null;
  const constraints = extractConstraints(instruction, facts);
  const explicitSubject = /(?:产品名|名称|主题)(?:是|为|叫|：|:)/.test(instruction);
  const taskBrief = {
    taskId: crypto.randomUUID(), version: 1, status: 'analyzed', instruction, platform: normalizedPlatform, platformMode: mode, tone,
    subject: { name: subjectName, category: contentType, description: facts.verifiedFacts[0]?.statement || subjectName, origin: explicitSubject || facts.verifiedFacts.length ? 'user_provided' : 'inferred' },
    contentType, purpose: inferPurpose(instruction, contentType), questionTitle,
    facts: facts.verifiedFacts, opinions: facts.opinions, experiences: facts.experiences,
    unknowns: [...facts.unknowns, ...constraints.unsupportedClaims.map((statement, index) => ({ unknownId: `unknown_${String(index + 1).padStart(3, '0')}`, statement, reason: '缺少可核验数字或证据' }))],
    constraints, sourceIds: materials.map((material) => material.id),
    analysisProvider: 'rules-v2', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const assessment = assessRequest({ instruction, factSet: facts, platform: normalizedPlatform, platformMode: mode, taskBrief });
  taskBrief.questions = assessment.questions;
  taskBrief.status = assessment.enough ? 'awaiting_strategy' : 'needs_input';
  taskBrief.strategyOptions = assessment.enough ? recommendStrategies(taskBrief) : [];
  return { taskBrief, factSet: facts };
}

export function publicTaskBrief(taskBrief) {
  const stripInternal = (items = []) => items.map(({ displayName, evidence, ...item }) => item);
  return { ...taskBrief, facts: stripInternal(taskBrief.facts), opinions: stripInternal(taskBrief.opinions), experiences: stripInternal(taskBrief.experiences) };
}
