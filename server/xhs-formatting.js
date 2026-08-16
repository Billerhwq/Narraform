const PLATFORM_FEELS = Object.freeze({
  restrained: {
    id: 'restrained', label: '克制清楚', density: 'low',
    emoji: { minCount: 0, maxCount: 2 },
    description: '少表情、少感叹，先把事实和边界说清楚',
  },
  natural: {
    id: 'natural', label: '自然分享', density: 'medium',
    emoji: { minCount: 1, maxCount: 4 },
    description: '短段落、轻口语，用少量视觉锚点帮助扫读',
  },
  active: {
    id: 'active', label: '更活跃', density: 'high',
    emoji: { minCount: 3, maxCount: 6 },
    description: '节奏更明快，但不堆表情或套用装熟口吻',
  },
});

const CONTENT_PATTERNS = Object.freeze({
  product_marketing: {
    id: 'scenario_value',
    structure: ['使用条件或问题', '产品作用', '已确认能力', '适合人群', '边界', '行动'],
    hookTypes: ['scene', 'problem', 'audience_filter', 'information_gap'],
    ctaMode: 'soft_action',
  },
  tutorial: {
    id: 'task_steps',
    structure: ['结果预告', '前置条件', '步骤', '验证', '常见错误'],
    hookTypes: ['result', 'task', 'pitfall'],
    ctaMode: 'save_for_task',
  },
  opinion: {
    id: 'judgement_reasoning',
    structure: ['判断', '原因', '事实或例子', '反例或边界', '收束'],
    hookTypes: ['opinion', 'counter_intuitive', 'problem'],
    ctaMode: 'discussion',
  },
  personal_story: {
    id: 'experience_reflection',
    structure: ['真实场景', '决策', '变化', '反思'],
    hookTypes: ['scene', 'conflict'],
    ctaMode: 'discussion',
  },
  case_study: {
    id: 'case_evidence',
    structure: ['背景', '方法', '证据', '结果', '限制'],
    hookTypes: ['result', 'problem'],
    ctaMode: 'soft_action',
  },
  event_announcement: {
    id: 'event_action',
    structure: ['对象', '价值', '时间规则', '参与方式'],
    hookTypes: ['result', 'audience_filter'],
    ctaMode: 'direct_action',
  },
  release_update: {
    id: 'change_impact',
    structure: ['变化', '用户影响', '使用方式', '注意事项'],
    hookTypes: ['result', 'problem'],
    ctaMode: 'soft_action',
  },
  brand_story: {
    id: 'origin_choice',
    structure: ['起点', '选择', '价值判断', '当下'],
    hookTypes: ['scene', 'opinion'],
    ctaMode: 'none',
  },
  general_article: {
    id: 'question_explainer',
    structure: ['具体问题', '信息展开', '建议或判断'],
    hookTypes: ['problem', 'scene', 'information_gap'],
    ctaMode: 'discussion',
  },
});

const HIGH_RISK = /医疗|疾病|药物|治疗|法律|诉讼|合同效力|金融|投资|理财|贷款|保险|安全事故|人身安全/;
const PROFESSIONAL = /技术|工程|代码|开发|API|架构|权限|合规|专业|严肃|研究|报告/;
const ACTIVE_CONTEXT = /生活方式|穿搭|美妆|旅行|探店|家居|好物|日常分享|轻松|活泼/;

function sourceText(taskBrief = {}, strategy = {}, tone = '') {
  return [
    taskBrief.instruction,
    taskBrief.subject?.name,
    taskBrief.subject?.description,
    ...(taskBrief.facts || []).map((fact) => fact.statement),
    strategy.authorRole,
    strategy.goal,
    tone,
  ].filter(Boolean).join('\n');
}

function materialDensity(taskBrief = {}) {
  const count = (taskBrief.facts || []).length + (taskBrief.experiences || []).length;
  if (count <= 2) return { id: 'sparse', factCount: count, bodyMin: 180, bodyMax: 350 };
  if (count <= 6) return { id: 'normal', factCount: count, bodyMin: 300, bodyMax: 600 };
  return { id: 'rich', factCount: count, bodyMin: 500, bodyMax: 800 };
}

function requestedFeel(override = {}) {
  const value = override.platformFeel;
  return value && value !== 'auto' && PLATFORM_FEELS[value] ? value : null;
}

function automaticFeel(taskBrief, strategy, tone) {
  const text = sourceText(taskBrief, strategy, tone);
  if (HIGH_RISK.test(text) || /克制|简洁|少营销|不要营销|少表情|不要表情|专业解读/.test(text)) return 'restrained';
  if (taskBrief.contentType === 'opinion') return 'restrained';
  if (taskBrief.contentType === 'product_marketing') return 'natural';
  if (taskBrief.contentType === 'tutorial') return 'natural';
  if (ACTIVE_CONTEXT.test(text)) return 'active';
  if (PROFESSIONAL.test(text)) return 'restrained';
  return 'natural';
}

function hookType(pattern, strategy = {}) {
  const hook = String(strategy.hook || '');
  if (/结果/.test(hook) && pattern.hookTypes.includes('result')) return 'result';
  if (/判断|观点|结论/.test(hook) && pattern.hookTypes.includes('opinion')) return 'opinion';
  if (/人群|适合/.test(hook) && pattern.hookTypes.includes('audience_filter')) return 'audience_filter';
  if (/问题|麻烦|阻力/.test(hook) && pattern.hookTypes.includes('problem')) return 'problem';
  return pattern.hookTypes[0];
}

function ctaMode(pattern, strategy = {}) {
  const intent = String(strategy.ctaIntent || '');
  if (/报名|购买|立即|行动/.test(intent)) return 'direct_action';
  if (/试用|体验|判断|咨询/.test(intent)) return 'soft_action';
  if (/收藏|复用/.test(intent)) return 'save_for_task';
  if (/讨论|评论/.test(intent)) return 'discussion';
  return pattern.ctaMode;
}

export const XHS_FORMATTING_CONFIG = Object.freeze({
  platformFeelProfiles: PLATFORM_FEELS,
  contentPatterns: CONTENT_PATTERNS,
  allowedEmojiRoles: ['section_anchor', 'highlight', 'warning', 'action', 'emotion'],
  paragraphPolicy: { sentencesPerParagraph: [1, 3], targetParagraphs: [4, 8], maxContinuousCharacters: 120 },
  topicPlan: { broad: [1, 2], category: [2, 3], sceneOrAudience: [1, 2], brand: [0, 1], total: [3, 8] },
});

export function resolveXhsFormattingProfile({ taskBrief = {}, strategy = {}, userOverride = {}, tone = '' } = {}) {
  const contentType = CONTENT_PATTERNS[taskBrief.contentType] ? taskBrief.contentType : 'general_article';
  const pattern = CONTENT_PATTERNS[contentType];
  const text = sourceText(taskBrief, strategy, tone);
  const explicit = requestedFeel(userOverride);
  let feelId = explicit || automaticFeel(taskBrief, strategy, tone);
  const reasons = [contentType, explicit ? `用户选择 ${PLATFORM_FEELS[explicit].label}` : '系统自动匹配'];
  if (!explicit && HIGH_RISK.test(text)) reasons.push('高风险主题降低平台感');
  if (!explicit && PROFESSIONAL.test(text)) reasons.push('专业内容降低 Emoji 密度');
  const feel = PLATFORM_FEELS[feelId];
  const density = materialDensity(taskBrief);
  let emojiMin = feel.emoji.minCount;
  let emojiMax = feel.emoji.maxCount;
  if (feelId === 'natural' && density.id !== 'sparse') emojiMin = Math.max(emojiMin, 2);
  if (contentType === 'product_marketing') {
    emojiMax = Math.min(emojiMax, 3);
    emojiMin = Math.min(emojiMin, emojiMax);
  }
  if (contentType === 'tutorial' && feelId !== 'restrained') {
    emojiMin = Math.max(emojiMin, 2);
    emojiMax = Math.min(5, Math.max(emojiMax, 4));
  }
  if (contentType === 'opinion') emojiMax = Math.min(emojiMax, 2);
  if (userOverride.emoji === 'none' || /不要表情|不用表情|无表情/.test(text)) {
    emojiMin = 0;
    emojiMax = 0;
  }
  return validateXhsFormattingProfile({
    platformFeel: feelId,
    platformFeelLabel: feel.label,
    platformFeelDescription: feel.description,
    contentPattern: pattern.id,
    structure: [...pattern.structure],
    hookType: hookType(pattern, strategy),
    allowedHookTypes: [...pattern.hookTypes],
    emojiPolicy: {
      density: emojiMax === 0 ? 'none' : feel.density,
      recommendedMin: emojiMin,
      maxCount: emojiMax,
      allowedRoles: [...XHS_FORMATTING_CONFIG.allowedEmojiRoles],
      maxConsecutive: 2,
    },
    paragraphPolicy: { ...XHS_FORMATTING_CONFIG.paragraphPolicy },
    listPolicy: { allowed: ['steps', 'checklist', 'comparison', 'warnings', 'resources'], onePrimaryStyle: true },
    ctaMode: ctaMode(pattern, strategy),
    topicPlan: { ...XHS_FORMATTING_CONFIG.topicPlan },
    materialDensity: density.id,
    lengthTarget: { bodyMin: density.bodyMin, bodyMax: density.bodyMax },
    selectionReasons: [...reasons, `资料量 ${density.id}`],
  });
}

export function validateXhsFormattingProfile(profile) {
  if (!PLATFORM_FEELS[profile?.platformFeel]) throw new Error('XHS FormattingProfile 平台感无效');
  if (!Object.values(CONTENT_PATTERNS).some((pattern) => pattern.id === profile.contentPattern)) throw new Error('XHS FormattingProfile 内容结构无效');
  if (!Number.isInteger(profile.emojiPolicy?.maxCount) || profile.emojiPolicy.maxCount < 0 || profile.emojiPolicy.maxCount > 6) throw new Error('XHS FormattingProfile Emoji 范围无效');
  if (!profile.lengthTarget || profile.lengthTarget.bodyMin > profile.lengthTarget.bodyMax) throw new Error('XHS FormattingProfile 长度范围无效');
  return profile;
}

export function getPublicXhsFormatting(profile) {
  if (!profile) return null;
  return {
    platformFeel: profile.platformFeel,
    label: profile.platformFeelLabel,
    description: profile.platformFeelDescription,
  };
}

export function normalizeXhsFormattingOverride(value = {}) {
  return {
    platformFeel: value.platformFeel === 'auto' || PLATFORM_FEELS[value.platformFeel] ? value.platformFeel : 'auto',
    emoji: value.emoji === 'none' ? 'none' : 'auto',
  };
}
