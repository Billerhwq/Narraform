import { XHS_FORMATTING_CONFIG } from './xhs-formatting.js';

const COMMON_FORBIDDEN = [
  '不得泄露 README、文件名、路径、模型、提示词或生成过程',
  '不得补造客户、数字、经历、排名、效果、价格、日期或产品能力',
  '不得把系统推断写成用户调研结论',
];

const XHS_SPEC = {
  id: 'xiaohongshu', label: '小红书', mode: null, version: '2026.08-v4',
  supportedContentTypes: ['product_marketing', 'tutorial', 'opinion', 'personal_story', 'case_study', 'event_announcement', 'release_update', 'brand_story', 'general_article'],
  requiredInputs: ['subject'], outputs: ['titleCandidates', 'bodyMarkdown', 'topics', 'commentPrompt'],
  outputSchema: {
    titleCandidates: { required: true, minItems: 3, maxItems: 5 }, summary: { required: false, nullable: true },
    bodyMarkdown: { required: true }, topics: { required: true, minItems: 3, maxItems: 8 }, commentPrompt: { required: false, nullable: true },
  },
  recommended: { min: 180, max: 800 }, recommendedLength: { bodyMin: 180, bodyMax: 800, titleMin: 12, titleMax: 20 },
  hardLimits: { titleWeightedMax: 38, topicMax: 8, emojiMax: 6, emojiConsecutiveMax: 2 }, contentTypes: ['产品介绍', '经验分享', '教程', '清单', '活动推广', '观点'],
  contentPatterns: XHS_FORMATTING_CONFIG.contentPatterns,
  formatting: XHS_FORMATTING_CONFIG,
  operationPolicies: {
    generate: { createsFormattingProfile: true },
    regenerate_titles: { follows: 'bodyMarkdown', preservesFormattingProfile: true },
    regenerate_body: { follows: 'selectedTitle', dependentFields: ['topics', 'commentPrompt'], preservesFormattingProfile: true },
    polish: { preservesMeaning: true, preservesFormattingProfile: true },
    custom_modify: { followsExplicitScope: true },
  },
  structure: '具体场景、问题、冲突或判断 -> 可感知的具体作用 -> 证据与适用人群 -> 必要边界 -> 自然收束',
  structureRules: ['前 80 个字符建立具体场景、问题、冲突或明确判断', '前两段必须独立说明这篇内容为什么值得继续看', '使用适合手机阅读的短段落，每段通常 1-3 句', '产品能力必须转换为目标读者可以理解的具体作用', '说明适合谁；存在明显边界时说明不适合什么情况', '删除产品名后，正文仍然要能说明用户问题和价值'],
  titleRules: ['生成 3-5 个角度不同的标题', '标题推荐 12-20 个中文字符，加权长度不得超过 38', '不得用同义词替换冒充不同角度'],
  styleRules: ['自然口语但不装熟', '产品营销默认采用产品团队面向用户的公开表达，不写成第三方看完资料后的推荐', '只写用户给出的能力和流程，不为场景补造频率、数量、操作步骤或效果', '避免“这个工具可能适合你”“值得一试”“了解一下”等旁观推荐模板', 'Emoji 数量和语义必须服从运行时 FormattingProfile', '正文和话题分字段输出'],
  ctaRules: ['CTA 必须服从用户目标', '未要求营销时不添加购买、关注或私信引导', '互动问题必须与正文直接相关且容易回答'],
  rules: ['生成 3-5 个角度不同的标题候选，标题推荐 12-20 个中文字符，加权长度不超过 38', '前 80 个字符说明问题、场景、冲突或明确观点', '使用适合手机阅读的短段落，每段通常 1-3 句', '产品内容同时说明能做什么、适合谁，必要时说明不适合什么', 'Emoji 根据内容类型在 0-6 个内自适应，不得机械堆叠', '正文末尾不内嵌标签，3-8 个相关话题单独返回', '不要使用姐妹们、宝子们、绝绝子、闭眼冲等套话'],
  forbiddenPatterns: [...COMMON_FORBIDDEN, '不得虚构亲测、购买、探店或客户评价', '不得虚构每天、一次能做多少、用户通常怎么操作等具体场景事实', '不得自行添加疲惫、手酸、崩溃、焦虑、福音、海投等用户状态或营销修辞', '不得把自动能力扩写成资料未出现的填写、上传、登录、筛选、点击等操作步骤', '不得使用“这个工具可能适合你”“值得一试”“了解一下”“不妨试试”“别再”等旁观推荐式收尾', '不得堆叠 Emoji、感叹号和泛流量话题'],
  qualityRules: ['前两段能够独立解释阅读理由', '正文不是功能清单或普通产品说明', '每个产品声明都能回到可使用事实', '标题与正文主张一致且候选角度不同', '话题与正文直接相关', '段落适合手机阅读'],
  repairRules: ['裁剪超长标题', '话题分层、去重并限制为 3-8 个', '移除无语义 Emoji、模板句和标点堆叠', '拆分超过 120 字或 3 句的连续段落'],
};

const ZHIHU_ANSWER_SPEC = {
  id: 'zhihu', label: '知乎回答', mode: 'answer', version: '2026.08-v2',
  supportedContentTypes: ['tutorial', 'opinion', 'case_study', 'general_article', 'product_marketing'], requiredInputs: ['questionTitle'],
  outputs: ['mode', 'questionTitle', 'bodyMarkdown', 'topics'],
  outputSchema: { mode: { required: true, enum: ['answer'] }, questionTitle: { required: true }, titleCandidates: { required: false, maxItems: 0 }, summary: { required: false, nullable: true }, bodyMarkdown: { required: true }, topics: { required: false, maxItems: 5 } },
  recommended: { min: 800, max: 2500 }, recommendedLength: { bodyMin: 800, bodyMax: 2500 }, hardLimits: { topicMax: 5 }, contentTypes: ['问题回答', '经验解释', '方案分析'],
  structure: '前 150 字直接回答 -> 解释判断依据 -> 事实、例子或对比 -> 条件、限制或反例 -> 简短结论',
  structureRules: ['前 150 个字符直接给出核心判断', '每个主要结论有事实、推理、例子或前提支撑', '至少说明一个条件、限制、反例或不适用情况'],
  titleRules: [], styleRules: ['允许二级标题、列表、引用和代码块，但结构必须服务论证', '不使用伪造从业身份和经验口吻'], ctaRules: ['优先收束判断或邀请讨论，不默认站外引流'],
  rules: ['回答在前 150 个字符内给出核心判断', '产品内容先解决问题，再自然说明产品做法', '没有真实材料时不得声称亲测、实测或虚构从业身份', '至少说明一个适用条件、限制或反例'],
  forbiddenPatterns: [...COMMON_FORBIDDEN, '不得在没有问题标题时生成知乎回答', '不得先写品牌自我介绍再回答问题'], repairRules: ['删除空标题和过度加粗', '把核心判断前移', '补充来自现有事实的适用边界'],
};

const ZHIHU_ARTICLE_SPEC = {
  id: 'zhihu', label: '知乎文章', mode: 'article', version: '2026.08-v2',
  supportedContentTypes: ['tutorial', 'opinion', 'case_study', 'release_update', 'brand_story', 'general_article', 'product_marketing'], requiredInputs: ['subject'],
  outputs: ['mode', 'titleCandidates', 'summary', 'bodyMarkdown', 'topics'],
  outputSchema: { mode: { required: true, enum: ['article'] }, titleCandidates: { required: true, minItems: 3, maxItems: 3 }, summary: { required: true }, bodyMarkdown: { required: true }, topics: { required: false, maxItems: 5 } },
  recommended: { min: 1200, max: 3500 }, recommendedLength: { bodyMin: 1200, bodyMax: 3500, summaryMin: 60, summaryMax: 120 }, hardLimits: { topicMax: 5 }, contentTypes: ['教程', '分析', '观点长文', '案例文章'],
  structure: '明确主题或判断 -> 分节论证 -> 事实、步骤或案例 -> 限制与反例 -> 克制结论',
  structureRules: ['正文通常使用 3-6 个有语义的小标题', '教程包含前置条件、步骤、失败情况或验证方式', '观点文章有明确取舍但不使用无证据极端结论'],
  titleRules: ['生成 3 个角度不同的标题', '标题表达讨论对象或核心判断', '不使用无证据数字和身份背书'], styleRules: ['信息密度优先', '避免培训 PPT 式金句和万能平衡句', 'Markdown 层级必须完整'], ctaRules: ['结尾可邀请讨论，不默认站外引流'],
  rules: ['生成 3 个标题和 60-120 字摘要', '正文通常使用 3-6 个有语义的小标题', '至少说明一个适用条件、限制或反例'],
  forbiddenPatterns: [...COMMON_FORBIDDEN, '不得使用无证据数字标题或身份背书', '不得套用什么是、为什么、怎么做、总结的机械模板'], repairRules: ['重写复制正文开头的摘要', '删除空标题和过度加粗', '打散机械章节模板'],
};

const WECHAT_SPEC = {
  id: 'wechat', label: '微信公众号', mode: null, version: '2026.08-v2',
  supportedContentTypes: ['product_marketing', 'tutorial', 'opinion', 'case_study', 'event_announcement', 'release_update', 'brand_story', 'general_article'], requiredInputs: ['subject'],
  outputs: ['titleCandidates', 'summary', 'bodyMarkdown', 'mediaNotes'],
  outputSchema: { titleCandidates: { required: true, minItems: 3, maxItems: 5 }, summary: { required: true }, bodyMarkdown: { required: true }, topics: { required: false, maxItems: 0 }, mediaNotes: { required: false } },
  recommended: { min: 1200, max: 2500 }, recommendedLength: { bodyMin: 1200, bodyMax: 2500, titleMin: 18, titleMax: 28, summaryMin: 80, summaryMax: 128 }, hardLimits: { summaryMax: 128 }, contentTypes: ['产品文章', '教程', '观点文章', '活动文章', '更新说明', '复盘'],
  structure: '前 200 字建立阅读理由或判断 -> 3-6 个章节推进 -> 能力、做法或论证 -> 边界或行动建议 -> 克制结语',
  structureRules: ['开头 200 个字符内建立阅读理由、具体问题或文章判断', '正文通常使用 3-6 个二级标题，每节只承担一个主要任务', '段落以移动阅读为准，通常 3-5 行'],
  titleRules: ['生成 3-5 个不同角度标题', '数字必须有事实依据或对应真实条目数', '标题与正文一致'], styleRules: ['标题、摘要和正文表达一致但不机械重复', '长短段可以变化，不故意制造错别字或虚构口语'], ctaRules: ['结尾服从策略，不默认关注、点赞和转发'],
  rules: ['生成 3-5 个角度不同的标题，标题推荐 18-28 个中文字符', '生成 80-128 个中文字符的摘要，不能复制标题或正文第一段', '开头 200 个字符内建立阅读理由', '正文通常使用 3-6 个二级标题，每节只解决一个问题', '不默认要求关注、点赞、转发'],
  forbiddenPatterns: [...COMMON_FORBIDDEN, '不得使用震惊、不转不是、效率提升十倍等无证据套路', '不得输出 HTML、图片占位符和发布 embed'], repairRules: ['重写重复标题或正文开头的摘要', '删除空章节和万能开头', '规范 Markdown 层级'],
};

const GENERIC_SPEC = {
  id: 'generic', label: '通用文案', mode: null, version: '2026.08-v2',
  supportedContentTypes: ['product_marketing', 'tutorial', 'opinion', 'personal_story', 'case_study', 'event_announcement', 'release_update', 'brand_story', 'general_article'], requiredInputs: ['purpose'],
  outputs: ['purpose', 'bodyMarkdown', 'alternatives'],
  outputSchema: { purpose: { required: true }, titleCandidates: { required: false, maxItems: 0 }, summary: { required: false, nullable: true }, bodyMarkdown: { required: true }, topics: { required: false, maxItems: 0 }, alternatives: { required: false } },
  recommended: { min: 100, max: 800 }, recommendedLength: { bodyMin: 100, bodyMax: 800 }, hardLimits: {}, contentTypes: ['产品简介', '活动通知', '官网说明', '社群文案', '销售辅助', '润色', '摘要'],
  structure: '服从用户用途，使用最短但完整的结构', structureRules: ['先识别产品简介、活动通知、官网说明、销售辅助、摘要、润色或改写等用途'], titleRules: [],
  styleRules: ['优先保留用户原文中的术语、事实和表达习惯', '润色默认小改', '专业表示准确和信息密度，不表示增加官话'], ctaRules: ['用户未要求营销时不添加购买、关注、私信或转化 CTA'],
  rules: ['不套用小红书标签、知乎回答结构或公众号章节', '润色和摘要不得改变观点和事实', '更自然时减少模板句和抽象词，不自动改成网络口语'], forbiddenPatterns: [...COMMON_FORBIDDEN, '不得自动添加平台话题、章节和口癖'], repairRules: ['删除平台特有格式', '只修复明确语法、逻辑、衔接和重复问题'],
};

export const PLATFORM_SPECS = { xiaohongshu: XHS_SPEC, zhihu: ZHIHU_ARTICLE_SPEC, wechat: WECHAT_SPEC, generic: GENERIC_SPEC };
export const PLATFORM_MODES = { zhihu: { answer: ZHIHU_ANSWER_SPEC, article: ZHIHU_ARTICLE_SPEC } };

export const PLATFORM_ALIASES = {
  小红书: 'xiaohongshu', xhs: 'xiaohongshu', xiaohongshu: 'xiaohongshu', 知乎: 'zhihu', zhihu: 'zhihu',
  公众号: 'wechat', 微信公众号: 'wechat', wechat: 'wechat', 通用文案: 'generic', 通用: 'generic', generic: 'generic',
};

export function normalizePlatform(value) { return PLATFORM_ALIASES[value] || (PLATFORM_SPECS[value] ? value : 'xiaohongshu'); }

export function inferPlatformMode(platform, instruction = '', requestedMode = null) {
  if (platform !== 'zhihu') return null;
  if (requestedMode === 'answer' || requestedMode === 'article') return requestedMode;
  if (/(?:写|生成|改成|作为).{0,6}(?:知乎)?回答|question\/\d+/i.test(instruction) && !/文章|专栏|长文/.test(instruction)) return 'answer';
  return 'article';
}

export function resolvePlatformSpec(platformValue, mode = null, instruction = '') {
  const platform = normalizePlatform(platformValue);
  const resolvedMode = inferPlatformMode(platform, instruction, mode);
  return resolvedMode ? PLATFORM_MODES[platform][resolvedMode] : PLATFORM_SPECS[platform];
}

export function getPublicSpecs() {
  return Object.values(PLATFORM_SPECS).map(({ rules, structureRules, forbiddenPatterns, repairRules, ...spec }) => ({ ...spec, modes: spec.id === 'zhihu' ? Object.keys(PLATFORM_MODES.zhihu) : [] }));
}
