# Narraform 小红书平台文案规范 v4

状态：Implemented and engineering-verified  
版本：2026.08-v4  
上位规范：`NARRAFORM-PLATFORM-COPY-SPEC-v2.md`  
关联规范：`PRD-content-operation-spec-v1.md`  
适用操作：首次生成、换标题、换正文、润色、自定义修改  
不包含：图片生成、贴纸素材生成、账号登录、发布、数据回流

## 1. 目的

本规范定义 Narraform 如何生成符合小红书阅读习惯、但不依赖固定网感模板的文案。系统必须根据内容类型、作者身份、读者目标、资料充足度和用户偏好，自适应选择结构、段落、Hook、Emoji、CTA 和话题策略。

本规范不把“像小红书”简化为增加 Emoji、感叹号和网络用语。平台感必须来自移动端可扫读结构、具体信息、真实口吻、自然互动和标题正文一致性。

## 2. 规则优先级

```text
法律、安全与事实边界
> 用户明确要求
> 小红书硬限制
> 当前 Content Operation 字段权限
> XHS Platform Spec
> 自动 FormattingProfile
> 模型默认偏好
```

冲突处理：

- 用户要求“活跃”不能覆盖事实安全和禁用表达。
- 用户要求“不要 Emoji”时，`emojiPolicy.maxCount` 必须为 0。
- 用户没有提供真实体验时，任何模式都不得生成亲测口吻。
- 操作只允许改标题时，格式化规则不得借机改正文、话题或 CTA。

## 3. 运行时合同

小红书每次内容操作必须由以下合同编译：

```text
TaskBrief
+ StrategySpec
+ XhsPlatformSpec
+ OperationSpec
+ UserFormattingOverride（可选）
= RuntimeGenerationContract
```

`FormattingProfile` 是 `XhsPlatformSpec` 在运行时解析出的内部对象，不是要求用户填写的新表单。

### 3.1 输入合同

```json
{
  "taskBrief": {
    "subject": { "name": "产品或主题" },
    "contentType": "product_marketing",
    "facts": [],
    "opinions": [],
    "experiences": [],
    "constraints": {}
  },
  "strategy": {
    "audience": { "label": "目标读者", "origin": "inferred" },
    "goal": "帮助理解或促成行动",
    "authorRole": "产品团队",
    "coreMessage": "本篇核心信息",
    "ctaIntent": "invite_trial"
  },
  "operation": {
    "id": "generate",
    "writableFields": ["titleCandidates", "bodyMarkdown", "topics", "commentPrompt"]
  },
  "userFormattingOverride": {
    "platformFeel": "auto",
    "emoji": "auto"
  }
}
```

### 3.2 输出合同

对外内容结构保持向后兼容：

```json
{
  "titleCandidates": ["3-5 个角度不同的标题"],
  "bodyMarkdown": "正文，不包含话题标签",
  "topics": ["3-8 个话题字符串"],
  "commentPrompt": "可为空的自然互动问题"
}
```

内部结果新增：

```json
{
  "generationMeta": {
    "platformSpecVersion": "2026.08-v4",
    "formattingProfile": {
      "platformFeel": "natural",
      "contentPattern": "scenario_value",
      "hookType": "scene",
      "emojiPolicy": {
        "density": "low",
        "minCount": 1,
        "maxCount": 3,
        "allowedRoles": ["section_anchor", "warning", "action"]
      },
      "paragraphPolicy": {
        "sentencesPerParagraph": [1, 3],
        "targetParagraphs": [4, 8],
        "maxContinuousCharacters": 120
      },
      "ctaMode": "soft_action",
      "topicPlan": {
        "broad": [1, 2],
        "category": [2, 3],
        "sceneOrAudience": [1, 2],
        "brand": [0, 1]
      },
      "selectionReasons": ["产品营销", "产品团队身份", "资料量正常"]
    }
  }
}
```

`generationMeta` 供质量检查、后续操作和调试使用，不直接显示在正文中。

## 4. FormattingProfile 解析

### 4.1 用户可见的平台感

| 值 | 用户理解 | 默认语言表现 |
|---|---|---|
| `auto` | 由系统判断 | 根据内容类型和风险选择 |
| `restrained` | 克制清楚 | 少 Emoji、少感叹、信息优先 |
| `natural` | 像正常分享 | 适量口语、短段、轻互动 |
| `active` | 更有平台氛围 | 更强节奏和视觉锚点，但不装熟 |

首次生成默认 `auto`。用户没有选择时，系统不得反问用户。

### 4.2 自动选择规则

| 条件 | 默认平台感 | Emoji 范围 |
|---|---|---:|
| 技术、专业、严肃、风险说明 | `restrained` | 0-2 |
| 产品团队介绍产品 | `natural` | 1-3 |
| 普通经验分享 | `natural` | 2-4 |
| 教程、步骤、清单 | `natural` | 2-5，优先作分组锚点 |
| 生活方式、轻消费分享 | `active` | 3-6 |
| 观点短评 | `restrained` | 0-2 |

以下条件必须降低一级平台感：

- 医疗、法律、金融、安全等高风险主题。
- 资料稀少或大部分受众、痛点来自推断。
- 用户明确要求专业、简洁、少营销或不要网络用语。

### 4.3 资料充足度与长度

长度不是阻断条件。只要主体和至少一项可使用信息明确，系统应先生成可用文案。

| 资料等级 | 判断 | 推荐正文长度 |
|---|---|---:|
| `sparse` | 1-2 个可使用事实 | 180-350 字 |
| `normal` | 3-6 个可使用事实 | 300-600 字 |
| `rich` | 7 个以上事实、经历或案例 | 500-800 字 |

用户明确指定长度时优先服从。不得为了达到推荐长度补造场景、步骤、数字或效果。

## 5. 内容结构路由

模板只约束信息任务，不锁死句子。

| 内容类型 | 默认结构 | 可选 Hook | 默认 CTA |
|---|---|---|---|
| `product_marketing` | 使用条件或问题 → 产品作用 → 已确认能力 → 适合人群 → 边界 → 行动 | 场景、结果、问题、人群筛选 | 轻行动或自我判断 |
| `tutorial` | 结果预告 → 前置条件 → 步骤 → 验证 → 常见错误 | 结果、避坑、任务 | 尝试或收藏 |
| `opinion` | 判断 → 原因 → 事实或例子 → 反例或边界 → 收束 | 观点、反常识、问题 | 讨论 |
| `personal_story` | 真实场景 → 决策 → 变化 → 反思 | 场景、冲突 | 讨论或留白 |
| `case_study` | 背景 → 方法 → 证据 → 结果 → 限制 | 结果、问题 | 判断或咨询 |
| `event_announcement` | 对象 → 价值 → 时间规则 → 参与方式 | 结果、人群筛选 | 明确行动 |
| `release_update` | 变化 → 用户影响 → 使用方式 → 注意事项 | 变化、问题 | 查看或尝试 |
| `brand_story` | 起点 → 选择 → 价值判断 → 当下 | 场景、观点 | 认识品牌或留白 |
| `general_article` | 具体问题 → 信息展开 → 建议或判断 | 问题、信息差、场景 | 讨论或留白 |

### 5.1 产品营销附加规则

- MUST 采用产品团队或品牌主体面向用户的公开表达，不写成“从资料得知”的第三方推荐。
- MUST 把能力翻译成具体作用，但具体作用不能超出事实。
- SHOULD 先让读者理解任务，再出现产品名。
- MUST 根据资料自然宣传；缺少量化数据不构成 `needs_input`。
- MUST NOT 添加“我用了几天”“亲测”“客户都说”等未提供经历。
- MUST NOT 把一个能力扩写成资料中不存在的完整操作流程。
- 明显边界存在时 MUST 说明；没有边界事实时不得编造“缺点”来显得真实。

## 6. Hook 规范

### 6.1 Hook 类型

| 类型 | 用途 | 示例形态 |
|---|---|---|
| `scene` | 建立具体任务 | “如果你正在……，最麻烦的往往是……” |
| `result` | 先展示可验证结果 | “这次更新解决了……” |
| `problem` | 点明真实问题 | “真正费时间的不是……，而是……” |
| `counter_intuitive` | 提出有依据的反常识判断 | “功能越多，不一定越……” |
| `audience_filter` | 让目标读者快速判断 | “更适合……的人先看这一点。” |
| `opinion` | 直接给出观点 | “我的判断是……” |
| `information_gap` | 建立信息差 | “很多介绍漏掉了一个前提……” |

### 6.2 Hook 约束

- 前 80 个字符必须完成一个任务：场景、问题、冲突、结果或判断。
- 一篇只使用一个主 Hook，不叠加“痛点 + 震惊 + 悬念”。
- Hook 必须能由事实、观点或条件式场景支撑。
- 没有真实经历时，不得使用时间型亲历开头。
- 禁止默认使用“宝子们”“姐妹们”“家人们”“谁懂啊”。
- 禁止无内容支撑的“看完就懂”“建议收藏”“错过后悔”。

## 7. 标题规范

### 7.1 基础约束

- 输出 3-5 个候选。
- 推荐 12-20 个中文字符。
- 加权长度 MUST 不超过 38：中文和中文标点按 2，英文、数字和半角字符按 1。
- 标题最多使用 1 个 Emoji，`restrained` 默认不用。
- 标题不得使用正文没有支撑的数字、效果、身份、结果或经历。

### 7.2 候选差异

每批标题至少覆盖 3 个不同角度：

- 任务或场景
- 核心价值
- 适用人群
- 方法或清单
- 明确判断
- 信息差

只替换同义词、Emoji 或标点，不算新角度。

### 7.3 标题正文一致性

- 首次生成：标题和正文共享同一个 `coreMessage` 与事实集合。
- 换标题：以当前正文为事实边界和语义中心，内部重试直到全部候选与正文一致。
- 换正文：以当前选中标题为主张约束，不得弱化、扩大或改写标题承诺。
- 用户手动改标题后换正文：手动标题视为用户约束，但仍需执行事实检查。

## 8. 正文排版规范

### 8.1 段落

- 每段通常 1-3 句。
- 目标 4-8 个有效段落；短内容允许 3 段，教程可更多。
- 单个连续文本块 SHOULD 不超过 120 个中文字符。
- 段落长短必须有变化，不能整篇等长。
- 每段只承担一个信息任务。
- Hook、核心清单和 CTA 之间应有明确换行。
- 小红书正文不使用 `##`、`**粗体**` 等 Markdown 标题模拟排版。

### 8.2 清单

以下内容可以使用清单：步骤、检查项、对比维度、注意事项和资源集合。

以下内容不应强行清单化：故事、完整论证、情绪变化和只有两句话的普通说明。

允许格式：

- `1 / 2 / 3`
- `1. 2. 3.`
- `① ② ③`
- 单一语义 Emoji 作为分组锚点

一篇正文只选择一种主清单格式。

## 9. Emoji 规范

### 9.1 语义角色

Emoji 只能承担以下角色：

- `section_anchor`：分组或步骤锚点
- `highlight`：真正重要的信息
- `warning`：限制或注意事项
- `action`：结尾行动
- `emotion`：真实、适度的情绪

### 9.2 使用规则

- Emoji 数量必须服从当前 `FormattingProfile`。
- 同一 Emoji 不得连续重复。
- 不得出现超过 2 个 Emoji 的连续串。
- 不得每句话末尾机械添加 Emoji。
- 清单中 Emoji 用作锚点时，正文其他位置应减少 Emoji。
- 技术、专业和严肃内容优先使用符号或纯文本。
- Emoji 删除后不得破坏句子语法和含义。

### 9.3 明确禁止

- 用 `✨🔥‼️😍` 堆叠制造热度。
- 用表情代替事实或逻辑。
- 为了达到数量下限插入无语义 Emoji。
- 将 Unicode Emoji 与图片贴纸、表情包素材混为一体；图片贴纸属于后续视觉模块。

## 10. CTA 与评论引导

`commentPrompt` 是独立字段，不默认拼入正文。

| 目标 | CTA 模式 | 规则 |
|---|---|---|
| 理解 | `none` | 可以自然结束，不强行行动 |
| 收藏 | `save_for_task` | 只有教程、清单确有复用价值时使用 |
| 讨论 | `discussion` | 提一个容易回答、与正文直接相关的问题 |
| 试用或购买 | `soft_action` | 说明适合谁和下一步，不制造紧迫感 |
| 报名 | `direct_action` | 使用已确认时间、规则和入口 |

限制：

- 正文最多一个主行动。
- 评论问题最多一个。
- 禁止默认“点赞、收藏、关注三连”。
- 禁止“评论区扣 1”“私信领取”等未由用户要求的互动诱导。
- 未要求营销时，不得添加购买、咨询或私信 CTA。

## 11. 话题规范

### 11.1 输出与内部计划

对外继续输出 `string[]`，内部必须先生成带角色的话题计划：

```json
[
  { "label": "AI工具", "role": "broad", "source": "inferred" },
  { "label": "Agent编程", "role": "category", "source": "fact" },
  { "label": "程序员效率", "role": "scene", "source": "inferred" },
  { "label": "产品名", "role": "brand", "source": "fact" }
]
```

### 11.2 分层策略

- 大类词 `broad`：1-2 个。
- 品类词 `category`：2-3 个。
- 场景或受众词 `scene/audience`：1-2 个。
- 品牌词 `brand`：0-1 个。
- 总数推荐 5-8 个；资料稀少时允许 3-5 个。

### 11.3 质量规则

- 必须与标题或正文存在直接语义关系。
- 相近词去重，不能用四个标签重复表达同一概念。
- 不添加与正文无关的泛流量词。
- 用户添加的自定义标签默认保留，除非重复、为空或违反安全规则。
- 用户删除的标签在当前结果版本中不得被自动加回；重新生成全部内容时可重新建议。
- 正文不得内嵌标签列表。

## 12. 内容操作一致性

所有操作必须复用当前 `FormattingProfile`，除非用户明确改变平台感或格式要求。

| 操作 | 可改字段 | 必须保留 | 一致性要求 |
|---|---|---|---|
| `generate` | 全部小红书内容字段 | 无 | 生成并保存 FormattingProfile |
| `regenerate_titles` | `titleCandidates`, `selectedTitleIndex` | 正文、话题、评论问题、FormattingProfile | 所有新标题必须符合当前正文 |
| `regenerate_body` | `bodyMarkdown`, `topics`, `commentPrompt` | 当前选中标题、FormattingProfile | 新正文必须履行当前标题；话题和评论问题随正文更新 |
| `polish` | 目标范围内的正文 | 标题、事实、核心信息、话题、FormattingProfile | 只改变表达和排版，不改变主张 |
| `custom_modify` | 用户明确指定字段 | 其他字段、事实、未指定偏好 | 修改后重新校验相关字段 |

操作失败处理：

- 先在服务端根据质量问题自动修复，最多 2 轮。
- 可修复问题不得要求用户再次点击确认。
- 只有缺少主体、用户要求写入未提供的具体事实，或用户指令互相冲突时才返回 `needs_input`。
- 修复失败时保留当前版本，不用不合格结果覆盖用户内容。

## 13. 质量门

### 13.1 阻断检查

- 输出结构完整。
- 标题加权长度合规。
- 产品能力、数字、经历、案例和效果均有事实支持。
- 标题与正文主张一致。
- 换标题、换正文和润色没有越权修改字段。
- 没有虚构第一人称体验、用户评价和使用结果。
- 正文不包含内部资料名、README、路径、模型或生成过程。

### 13.2 自动修复检查

- Emoji 超出当前策略、连续堆叠或无语义重复。
- 连续大段、机械等长段落和多余 Markdown 标题。
- 话题重复、过泛、数量超限或被正文内嵌。
- CTA 重复或与目标不一致。
- 标题候选只有同义替换。
- 模板开头、机械三段论和空洞结尾。

### 13.3 建议性检查

- 前两段阅读理由偏弱。
- 具体信息密度偏低。
- 段落节奏过于均匀。
- 表达模式与主题气质不匹配。
- 评论问题过于宽泛。

建议项不得直接向普通用户显示技术错误文本。系统应自动处理，或在结果区域用自然语言提示“已按平台阅读习惯优化”。

## 14. 机器可执行结构

`platform-specs.js` 中的小红书规范应扩展为：

```js
{
  id: 'xiaohongshu',
  version: '2026.08-v4',
  outputSchema: {},
  recommendedLength: {},
  hardLimits: {},
  contentPatterns: {},
  formatting: {
    platformFeelProfiles: {},
    autoSelectionRules: [],
    paragraphPolicies: {},
    emojiPolicies: {},
    hookPolicies: {},
    listPolicies: {},
    ctaPolicies: {},
    topicPolicies: {}
  },
  operationPolicies: {},
  qualityRules: [],
  repairRules: []
}
```

新增解析函数：

```js
resolveXhsFormattingProfile({ taskBrief, strategy, userOverride })
validateXhsFormattingProfile(profile)
```

Prompt 只接收已经解析完成的 `FormattingProfile`，不得让模型自行解释“适量 Emoji”“自然排版”等模糊指令。

## 15. 验收样例

### 15.1 资料稀少的产品宣传

输入只包含产品名称、定位和一项能力时：

- 可以生成 180-350 字的宣传文案。
- 不要求用户补充数据、客户案例和使用截图。
- 不补造量化效果、操作步骤和亲测经历。

### 15.2 技术产品

- 默认 `restrained` 或 `natural`。
- Emoji 0-3 个。
- 使用具体任务、能力和边界，不使用“宝子们”“闭眼冲”。

### 15.3 教程清单

- Emoji 可以作为步骤锚点。
- 每个步骤包含可执行信息。
- 清单外不再随机添加 Emoji。

### 15.4 换一批

- 换标题后正文文本哈希不变。
- 换正文后选中标题文本不变。
- 新标题与正文或新正文与标题的一致性检查通过。
- 内部重试不要求用户再次确认。

### 15.5 手动编辑

- 用户手动正文和自定义标签自动保存。
- 换标题以已保存的当前正文为准。
- 删除的话题在当前结果版本中不自动恢复。

## 16. 版本与兼容

- v4 保持小红书对外内容字段兼容。
- `generationMeta.formattingProfile` 为新增可选字段，旧结果缺失时由系统按当前内容重新推断。
- 新规则只影响新生成或新操作，不批量改写历史内容。
- 规则命中、自动修复原因和版本写入内部日志，不进入用户正文。

## 17. 实现与验证记录

工程实现于 `server/xhs-formatting.js`、`server/platform-specs.js`、`server/content-engine.js`、`server/operation-engine.js`、`server/quality.js`、`server/store.js` 和 `src/main.jsx`。

已验证：

- `npm test`：191 项测试全部通过，包含 Profile 解析、操作字段权限、话题删除保持、排版质量门和接口隐私。
- `npm run test:e2e:xhs-formatting`：桌面与 390 x 844 移动视口闭环通过，无控制台错误和水平溢出。
- `npm run build`：生产构建通过；仅保留已知的大 chunk 性能警告。
- 普通 API 和用户界面不返回完整 `formattingProfile`、规则 ID、模型原始错误或内部重试细节。

工程验收不代替上线后的内容盲评和业务指标观测。
