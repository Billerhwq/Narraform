import crypto from 'node:crypto';

const CONTENT_LABELS = {
  product_marketing: '产品营销', tutorial: '教程', opinion: '观点', personal_story: '个人故事',
  case_study: '案例', event_announcement: '活动推广', release_update: '功能更新', brand_story: '品牌故事', general_article: '通用内容',
};

function audienceFor(taskBrief) {
  const text = [taskBrief.instruction, ...taskBrief.facts.map((fact) => fact.statement)].join(' ');
  if (/开发|工程|技术|代码|API|架构/.test(text)) return { label: '关注实际落地和边界的技术读者', reason: '资料包含技术、工程或实现信息' };
  if (/运营|创作者|内容|文案|自媒体/.test(text)) return { label: '需要稳定产出内容的运营与创作者', reason: '资料与内容生产任务直接相关' };
  if (/商家|门店|探店|本地生活/.test(text)) return { label: '正在比较本地服务或消费选择的用户', reason: '内容涉及商家或本地消费场景' };
  if (/学生|考试|学习|课程/.test(text)) return { label: '希望降低学习成本的学习者', reason: '资料涉及学习或课程场景' };
  return { label: '第一次接触该主题、希望快速判断是否适合自己的读者', reason: '未发现更明确的用户分群证据' };
}

function goalFor(contentType, instruction) {
  if (/报名|购买|试用|咨询|转化|推广|宣传|优惠/.test(instruction)) return '促成下一步行动';
  if (contentType === 'tutorial') return '帮助读者完成任务并形成收藏价值';
  if (contentType === 'opinion') return '表达清晰判断并引发讨论';
  if (contentType === 'event_announcement') return '让目标读者理解活动并决定是否参加';
  if (contentType === 'release_update') return '让现有用户理解变化和影响';
  return '帮助读者理解价值并判断是否适合自己';
}

function option({ key, name, description, readerSituation, coreMessage, hook, structure, ctaIntent, taskBrief, audience, goal, risk }) {
  const evidenceFactIds = taskBrief.facts.slice(0, 3).map((fact) => fact.factId);
  return {
    id: `strategy_${key}_${crypto.randomUUID().slice(0, 8)}`,
    key, name, description, audience: { ...audience, origin: 'inferred', confidence: 0.78 }, goal,
    readerSituation, coreMessage, hook, structure, ctaIntent,
    authorRole: taskBrief.contentType === 'product_marketing' ? '产品团队' : '内容作者',
    valueProposition: {
      pain: readerSituation,
      benefit: coreMessage,
      capability: taskBrief.facts[0]?.statement || '尚无可对外引用的能力事实',
      evidenceFactIds,
    },
    requiredFactIds: taskBrief.facts.slice(0, 6).map((fact) => fact.factId),
    forbiddenClaims: taskBrief.constraints.unsupportedClaims,
    risk,
  };
}

export function recommendStrategies(taskBrief) {
  const audience = audienceFor(taskBrief);
  const goal = goalFor(taskBrief.contentType, taskBrief.instruction);
  const subject = taskBrief.subject.name || '这个主题';
  const label = CONTENT_LABELS[taskBrief.contentType] || '内容';

  if (taskBrief.contentType === 'tutorial') {
    return [
      option({ key: 'task_first', name: '任务直达', description: '从读者要完成的任务进入，给出清晰步骤和验证方式。', readerSituation: '读者正在寻找可以立即执行的方法', coreMessage: `${subject}需要先讲清目标、步骤和限制`, hook: '先说明最终要完成什么，再进入具体做法', structure: ['目标', '前置条件', '步骤', '验证', '限制'], ctaIntent: '鼓励实际尝试或收藏', taskBrief, audience, goal, risk: '不得补造操作结果或不存在的步骤' }),
      option({ key: 'pitfall_first', name: '避坑路径', description: '从常见误区进入，用边界和失败条件增强可信度。', readerSituation: '读者已经尝试过，但容易在关键环节出错', coreMessage: `${subject}真正影响结果的是前置条件和容易忽略的细节`, hook: '先指出最容易出错的一步', structure: ['常见错误', '原因', '正确做法', '验证', '边界'], ctaIntent: '邀请读者核对自己的做法', taskBrief, audience, goal, risk: '没有真实经历时不得写成亲自踩坑' }),
      option({ key: 'framework', name: '框架拆解', description: '先建立判断框架，再把步骤放进框架中解释。', readerSituation: '读者不只想照做，也想理解为什么', coreMessage: `${subject}可以被拆成一组可判断、可复用的步骤`, hook: '用一个明确判断框架减少信息噪音', structure: ['判断框架', '逐项解释', '操作示例', '适用边界'], ctaIntent: '促进收藏和复用', taskBrief, audience, goal, risk: '不得为了完整而发明方法论名称' }),
    ];
  }

  if (taskBrief.contentType === 'opinion') {
    return [
      option({ key: 'direct_judgement', name: '直接判断', description: '开头给结论，再解释理由和适用边界。', readerSituation: '读者希望快速知道一个明确判断', coreMessage: `${subject}需要有取舍，而不是罗列所有可能`, hook: '第一段直接给出主要判断', structure: ['判断', '理由', '事实', '反例或边界'], ctaIntent: '邀请读者讨论不同场景', taskBrief, audience, goal, risk: '观点不得伪装成事实' }),
      option({ key: 'counter_example', name: '反例切入', description: '从一个常见但不完整的看法切入，解释它何时失效。', readerSituation: '读者对主流说法已有印象', coreMessage: `${subject}的关键在于条件，而不是口号`, hook: '指出一个常见判断遗漏的条件', structure: ['常见看法', '遗漏条件', '重新判断', '适用边界'], ctaIntent: '引导补充反例', taskBrief, audience, goal, risk: '不得制造不存在的争议' }),
      option({ key: 'decision_guide', name: '决策指南', description: '把观点转成读者可以使用的判断标准。', readerSituation: '读者需要据此作出选择', coreMessage: `${subject}应该根据具体目标和约束来判断`, hook: '先给出决定结果的两个关键条件', structure: ['判断条件', '不同选择', '风险', '结论'], ctaIntent: '帮助读者自我判断', taskBrief, audience, goal, risk: '不能用万能的各有优劣代替判断' }),
    ];
  }

  return [
    option({ key: 'pain_solution', name: '痛点解决', description: '从目标读者正在面对的问题进入，再解释产品如何发挥作用。', readerSituation: '读者正在用低效或重复的方式完成相关任务', coreMessage: `${subject}不是功能清单，而是解决一个具体任务的方法`, hook: '先写读者最熟悉、最具体的麻烦', structure: ['问题场景', '为什么难', '产品做法', '适用人群', '行动'], ctaIntent: /推广|试用|购买|报名/.test(taskBrief.instruction) ? '邀请体验或行动' : '帮助读者判断是否适合', taskBrief, audience, goal, risk: '不得夸大效果或补造效率数据' }),
    option({ key: 'scenario_value', name: '场景价值', description: '选一个真实使用场景，把能力转成读者能感知的作用。', readerSituation: '读者知道问题，但还不能把产品能力与自己的工作联系起来', coreMessage: `${subject}的价值要放在具体使用场景中解释`, hook: '用一个不需要虚构人物的任务场景开头', structure: ['任务场景', '原有阻力', '能力如何作用', '适用边界'], ctaIntent: '邀请读者对照自己的场景', taskBrief, audience, goal, risk: '没有真实资料时不得写成个人体验或客户故事' }),
    option({ key: 'evidence_explainer', name: '证据解释', description: '围绕已经确认的能力和边界组织内容，强调可信度。', readerSituation: '读者对营销表达敏感，更关心产品到底能做什么', coreMessage: `${subject}应该用可核对事实说明价值和限制`, hook: '先给出一个克制、可验证的结论', structure: ['核心判断', '事实依据', '具体作用', '限制', '适合谁'], ctaIntent: '帮助理性决策', taskBrief, audience, goal, risk: '资料不足时不应用确定口吻补齐结论' }),
  ];
}
