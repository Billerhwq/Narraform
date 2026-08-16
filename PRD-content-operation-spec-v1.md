# Narraform Content Operation Spec PRD v1

状态：Ready for implementation  
版本：2026.08-v1  
依赖：`NARRAFORM-PLATFORM-COPY-SPEC-v2.md`  
适用项目：Narraform Studio Prototype  

## 1. Summary

本 PRD 为 Narraform 增加一层机器可执行的 `Content Operation Spec`。首次生成、换一批标题、换一批正文、AI 润色和自定义修改不再依赖临时提示词或自然语言正则分支，而是通过同一个内容操作引擎执行。

每种操作拥有明确的输入、可修改字段、必须保留字段、质量门、重试条件和版本策略。平台规范继续决定“在目标平台怎么写”，操作规范只决定“本次允许改什么、必须保留什么”。

## 2. Contacts

| 角色 | 负责人 | 职责 |
|---|---|---|
| 产品负责人 | 待指定 | 确认范围、交互和验收标准 |
| 内容规范负责人 | 待指定 | 维护 PlatformSpec 与 OperationSpec |
| 前端负责人 | 待指定 | 操作入口、状态、撤销和差异展示 |
| 后端负责人 | 待指定 | 合同编译、执行器、质量门和版本记录 |
| 测试负责人 | 待指定 | 平台乘操作矩阵、回归和失败用例 |

## 3. Background

### 3.1 当前系统

当前内容生成合同由三层组成：

```text
TaskBrief（写什么）
+ StrategySpec（为什么这样写）
+ PlatformSpec（在目标平台怎么写）
= RuntimeGenerationContract
```

现有系统已经具备：

- 任务理解、事实集合和内容策略选择。
- 小红书、知乎、公众号和通用文案的 PlatformSpec。
- 首次生成、换标题、换正文和聊天式修改。
- 质量检查、事实约束、来源隔离和最多两轮自动修复。
- 本地草稿、手动保存和版本记录。

### 3.2 当前问题

1. `action` 仍是弱约束字符串。
2. `/api/modify` 主要通过自然语言正则判断换标题、换正文、自然化和精简。
3. 字段保护分散在不同代码分支中，没有统一权限矩阵。
4. “润色”没有可执行定义，容易退化为自由重写。
5. 自定义修改的作用范围不明确，模型可能修改用户未点名的字段。
6. 自动重试条件不统一。有些操作检查“结果是否变化”，有些只检查接口是否成功。
7. 结果没有统一记录本次操作、父版本、修改字段和保留字段。
8. 新增操作时容易继续堆叠正则和临时 Prompt。

### 3.3 Why now

编辑器已经有“换一批标题”“换一批正文”“继续让 AI 优化”等入口，并计划增加 AI 润色。如果不先建立操作规范，更多按钮会带来更多互相冲突的修改逻辑。

OperationSpec 是下一阶段的基础设施。它让产品入口、Prompt、质量检查、版本记录和测试围绕同一个合同工作。

### 3.4 不在本期范围

- 图片生成和图片编辑。
- 平台账号、登录、自动发布和发布回执。
- 团队、工作空间、权限和计费。
- 根据发布数据自动学习文风。
- 多人协同批注。
- 多人同时编辑同一篇文案时的实时协同冲突合并。

## 4. Objective

### 4.1 产品目标

让用户可以放心执行内容生成和修改操作，并明确知道系统会修改什么、保留什么。任何按钮都不能成为无边界的自由重写入口。

### 4.2 用户收益

- 换标题不会修改正文。
- 换正文始终跟随当前选中标题。
- 润色不会新增事实或偷偷重新立意。
- 自定义修改只影响用户点名的内容。
- 失败时系统内部重试，不要求用户重复确认。
- 每次成功修改都可以撤销或恢复上一版本。

### 4.3 工程目标

- 使用一个 `executeContentOperation` 执行入口。
- 使用版本化 OperationSpec 替代操作正则作为主路由。
- 使用统一输入、输出、质量门和变更记录。
- 保留现有 API 作为兼容适配器，降低迁移风险。

### 4.4 Key Results

1. 五种 V1 操作 100% 通过结构化 `operation` 路由，不依赖 Prompt 文本识别操作类型。
2. 在自动化测试中，非授权字段修改次数为 0。
3. 换标题、换正文和润色在模型首次返回无变化或不合格结果时，100% 进入内部重试。
4. 润色黄金用例中，新增无依据事实数量为 0，核心事实保留率为 100%。
5. 四个平台乘五种操作的最低合同测试全部通过。
6. 每个成功结果都保存 `operationId`、`operationSpecVersion`、`parentResultId` 和 `changeSet`。
7. 用户执行成功操作后，不出现二次确认弹窗；撤销操作在一个动作内完成。

## 5. Market Segments

### 5.1 主要用户

已经获得一份 AI 初稿，希望继续调整但不愿反复解释上下文的内容创作者。

用户任务：

> 当我已经有一份可编辑文案时，我希望只修改当前不满意的部分，这样我不需要担心其他已确认内容被破坏。

### 5.2 次要用户

需要按小红书、知乎、公众号等平台批量生产内容的内容运营人员。

用户任务：

> 当我在多个平台反复生成和修改内容时，我希望每个操作结果稳定可预测，这样我可以快速审核和交付。

### 5.3 用户约束

- 用户不理解 Prompt、Spec 或字段权限。
- 用户可能只输入“更自然一点”或“换一批”。
- 用户可能没有原始资料，只有当前正文。
- 用户需要快速结果，不希望每次操作都进入确认流程。
- 用户可能手工编辑过结果，系统必须以当前屏幕内容为准。

## 6. Value Propositions

| 用户问题 | 当前体验 | V1 价值 |
|---|---|---|
| AI 修改范围失控 | 修改正文时标题和话题也可能变化 | 字段权限由合同强制执行 |
| 润色越改越像 AI | 模型自由重写并添加套话 | 先诊断，再执行最小修改，再复审 |
| 换一批与当前内容脱节 | 新标题或正文重新从原始要求生成 | 标题以当前正文为准，正文以当前标题为准 |
| 失败后重复点击 | 用户重新发起相同操作 | 服务端自动重试并保留输入 |
| 不知道系统改了什么 | 只能肉眼对比整篇 | 返回 changeSet，支持撤销和查看差异 |
| 新功能不断增加特殊分支 | 每个按钮对应一套临时逻辑 | 新操作通过注册 OperationSpec 扩展 |

## 7. Solution

### 7.1 核心设计

生成合同从三层升级为四层：

```text
TaskBrief（事实与任务）
+ StrategySpec（受众、目标与核心信息）
+ PlatformSpec（平台结构与表达规则）
+ OperationSpec（本次允许修改什么）
= RuntimeContentContract
```

优先级：

```text
法律、安全与事实边界
> 用户明确要求
> OperationSpec 字段权限
> PlatformSpec 硬规则
> StrategySpec
> 风格偏好
> 模型默认判断
```

OperationSpec 不覆盖事实安全和平台硬规则。用户也不能通过自定义指令绕过事实边界。

### 7.2 V1 操作类型

```text
generate
regenerate_titles
regenerate_body
polish
custom_modify
```

不允许继续使用 `modify_titles`、`modify_body` 等自由字符串作为公开合同。旧值只能存在于兼容适配器中。

### 7.3 OperationSpec 数据结构

每个操作必须在 `operation-specs.js` 注册：

```js
{
  id: 'polish',
  version: '2026.08-v1',
  label: 'AI 润色',
  allowedScopes: ['body', 'selection'],
  requiredInputs: ['currentContent.bodyMarkdown'],
  referenceFields: ['selectedTitle', 'platform', 'taskBrief', 'factSet'],
  writableFields: ['bodyMarkdown'],
  preservedFields: [
    'titleCandidates',
    'selectedTitleIndex',
    'summary',
    'topics',
    'questionTitle',
    'strategyId',
    'platform'
  ],
  changePolicy: {
    mode: 'minimal_edit',
    requireDifference: true,
    defaultLengthDelta: 0.2,
    allowNewFacts: false,
    allowNewCta: false,
    allowStructureChange: false
  },
  qualityProfile: 'polish',
  retryPolicy: {
    maxTechnicalRetries: 1,
    maxQualityRepairs: 2,
    retryOnNoDifference: true
  },
  versionPolicy: 'snapshot_before_successful_apply'
}
```

MUST：

- `writableFields` 与 `preservedFields` 不能重叠。
- 所有结果在交付前执行字段权限校验。
- 模型返回非授权字段时，服务端用当前内容覆盖，不接受模型值。
- OperationSpec 必须有版本号并写入结果。

### 7.4 字段权限矩阵

`W` 表示可写，`P` 表示必须保留，`R` 表示只作为参考，`D` 表示由 PlatformSpec 决定。

| 字段 | generate | regenerate_titles | regenerate_body | polish | custom_modify |
|---|---:|---:|---:|---:|---:|
| `platform` | R | P | P | P | P，跨平台操作除外 |
| `platformMode` | D | P | P | P | P，显式切换除外 |
| `titleCandidates` | D/W | W | P | P | 按 `targetFields` |
| `selectedTitleIndex` | D/W | W，默认 0 | P | P | 按 `targetFields` |
| `summary` | D/W | P | P | P | 按 `targetFields` |
| `bodyMarkdown` | W | P/R | W | W | 按 `targetFields` |
| `topics` | D/W | P | P | P | 按 `targetFields` |
| `questionTitle` | D/W | P | P/R | P | 按 `targetFields` |
| `strategyId` | W/R | P | P | P | P |
| `factIds` | W/R | P/R | P/R | P/R | P/R |

自定义修改不得直接获得“全部字段可写”权限。它必须先解析出明确的 `targetFields`。

### 7.5 统一请求合同

新内部执行器接收：

```json
{
  "operation": "polish",
  "operationRequestId": "request_uuid",
  "taskId": "task_uuid",
  "strategyId": "strategy_uuid",
  "platform": "xiaohongshu",
  "platformMode": null,
  "tone": "自然、专业",
  "scope": {
    "type": "body",
    "start": null,
    "end": null,
    "selectedText": null,
    "contentHash": "sha256_of_current_body"
  },
  "preset": "de_ai",
  "customInstruction": null,
  "targetFields": ["bodyMarkdown"],
  "currentContent": {
    "resultId": "result_uuid",
    "titleCandidates": ["当前标题"],
    "selectedTitleIndex": 0,
    "summary": null,
    "bodyMarkdown": "当前正文",
    "topics": ["当前话题"],
    "questionTitle": null
  },
  "materialIds": []
}
```

请求规则：

- 修改类操作必须提交完整 `currentContent`，以屏幕当前内容为准。
- `scope.type=selection` 时必须提交开始位置、结束位置、选中文字和正文哈希。
- 哈希不匹配时返回 `409 CONTENT_STALE`，不得把旧选区写回新正文。
- 前端按钮必须直接提交结构化 `operation`，不能依赖自然语言识别。
- 聊天输入由 OperationResolver 解析后再进入执行器。

### 7.6 统一响应合同

```json
{
  "status": "completed",
  "operation": "polish",
  "operationId": "operation_uuid",
  "operationSpecVersion": "2026.08-v1",
  "platformSpecVersion": "2026.08-v3",
  "parentResultId": "previous_result_uuid",
  "result": {
    "resultId": "new_result_uuid",
    "titleCandidates": [],
    "selectedTitleIndex": 0,
    "summary": null,
    "bodyMarkdown": "修改后的正文",
    "topics": []
  },
  "changeSet": {
    "changedFields": ["bodyMarkdown"],
    "preservedFields": ["titleCandidates", "summary", "topics"],
    "changes": [
      {
        "field": "bodyMarkdown",
        "changeType": "replace",
        "beforeHash": "hash_before",
        "afterHash": "hash_after",
        "ranges": []
      }
    ],
    "summary": "删除重复表达并缩短长句"
  },
  "qualityReport": {},
  "attempts": {
    "providerCalls": 1,
    "technicalRetries": 0,
    "qualityRepairs": 1
  },
  "provider": "deepseek"
}
```

响应规则：

- `changedFields` 必须是 OperationSpec `writableFields` 的子集。
- `preservedFields` 的最终值必须与请求完全一致。
- `status=completed` 时必须存在有效 `result` 和 `qualityReport`。
- 没有实际差异时不得伪造成功，按对应操作的重试策略处理。

### 7.7 RuntimeContentContract 编译

合同编译器按以下顺序工作：

1. 加载 TaskBrief 和 FactSet。
2. 加载已确认 StrategySpec。
3. 解析 PlatformSpec 和平台模式。
4. 加载 OperationSpec。
5. 校验操作所需输入。
6. 建立字段读写权限。
7. 编译操作专属 Prompt 和结构化输出要求。
8. 执行模型或本地转换器。
9. 标准化输出。
10. 用当前内容覆盖所有非授权字段。
11. 生成 changeSet。
12. 执行公共、平台和操作质量门。
13. 必要时内部修复。
14. 保存操作记录和版本。

### 7.8 操作一：首次生成

#### 用户入口

用户输入要求并选择内容方向后生成。

#### 输入

- TaskBrief。
- FactSet。
- StrategySpec。
- PlatformSpec。
- tone。

#### 可修改字段

由 PlatformSpec `outputSchema` 决定。没有平台字段时必须返回空值或空数组，不能混入其他平台格式。

#### 验收条件

- 所有必填平台字段完整。
- 事实、经历和来源隔离通过。
- 标题、正文、摘要和话题彼此一致。
- 结果相对 `currentContent` 不要求差异，因为首次生成没有父内容。

#### needs_input

缺少主体、关键事实、知乎回答问题标题或用户要求的无依据数据时允许返回 `needs_input`。一次最多两个问题。

### 7.9 操作二：换一批标题

#### 用户入口

标题区“换一批”。点击后直接执行，不再次确认。

#### 最高参考

当前 `bodyMarkdown`，其次是当前 StrategySpec 和 FactSet。

#### 允许修改

- `titleCandidates`。
- `selectedTitleIndex`，成功后默认设为 0。

#### 必须保留

- 正文、摘要、话题、平台、策略和事实 ID。

#### 质量门

- 每个标题准确概括当前正文。
- 不引入正文没有的功能、场景、效果或观点。
- 标题候选角度彼此不同。
- 与上一批标题存在明显差异。
- 符合平台标题数量和长度限制。

#### 自动重试

以下情况最多内部重试两次：

- 标题数组为空或数量不合格。
- 与上一批完全相同。
- 候选之间只有同义词替换。
- 标题与当前正文不一致。
- 非授权字段发生变化。

### 7.10 操作三：换一批正文

#### 用户入口

正文区“换一批”。点击后直接执行，不再次确认。

#### 最高参考

当前选中标题。标题必须作为正文的主题和边界，而不是普通提示。

#### 允许修改

- `bodyMarkdown`。

#### 必须保留

- 全部标题候选和当前选中项。
- 摘要、话题、平台、策略和事实 ID。

#### 质量门

- 开头、核心信息和结尾与当前标题一致。
- 与旧正文采用明显不同的表达或结构。
- 不增加新事实。
- 不因换正文顺便修改话题和摘要。
- 仍满足 PlatformSpec 的正文结构和长度。

#### 自动重试

正文为空、与旧正文相同、与标题不一致、无依据事实增加或平台质量门不通过时，最多内部重试两次。

### 7.11 操作四：AI 润色

#### 产品定义

润色不是重新生成。系统只修复可以明确诊断的问题，并尽量保持原事实、观点、顺序和作者声音。

#### V1 范围

- 整篇正文润色。
- 选中文字润色。
- 不支持一次同时润色标题、摘要和话题。

#### 预设

| preset | 目标 | 默认允许变化 |
|---|---|---|
| `de_ai` | 删除模板句、机械过渡、对称排比和空泛总结 | 句式、连接词、重复内容 |
| `natural` | 更自然但不改成网络黑话 | 句式、用词和段落节奏 |
| `concise` | 删除重复和低信息内容 | 允许缩短，核心事实必须保留 |
| `logic` | 修复指代、顺序、因果跳跃和衔接 | 可调整段内顺序 |
| `platform_tone` | 贴近当前平台阅读方式 | 受 PlatformSpec 约束 |
| `custom` | 执行一条明确润色要求 | 仍受 polish 权限约束 |

#### 润色流水线

```text
锁定事实与保护词
-> 诊断明确问题
-> 生成最小修改方案
-> 修改正文或选区
-> 语义与事实对比
-> 平台复审
-> 内部修复
-> 生成 changeSet
```

#### 硬性限制

- 不新增产品能力、数字、案例、体验、效果或 CTA。
- 不修改标题、摘要和话题。
- 不改变原文核心观点。
- 默认总长度变化不超过正负 20%。`concise` 可以突破下限，但必须保留核心事实。
- 默认不改变章节结构。只有 `logic` 或用户明确要求时可以调整结构。
- 没有 TaskBrief 时，把当前正文作为受保护基线，只允许改写已有含义。

#### 选区规则

- 只替换指定范围。
- 选区前后文本必须原样保留。
- 修改后检查前后句是否衔接。
- 正文哈希变化时拒绝应用旧结果。

#### 交付标准

- 至少修复一个诊断问题，否则返回 `no_change`，不伪造修改。
- 新增无依据声明为 0。
- 保护词保留率 100%。
- AI 味触发项不增加。
- 质量分不能低于修改前。

### 7.12 操作五：自定义修改

#### 用户入口

用户通过底部输入框提出“换个开头”“补充适用边界”“把第二段缩短”等要求。

#### OperationResolver

聊天指令必须先解析为：

```json
{
  "operation": "custom_modify",
  "targetFields": ["bodyMarkdown"],
  "scope": { "type": "body" },
  "intent": "rewrite_opening",
  "constraints": ["preserve_facts", "preserve_remaining_body"],
  "confidence": 0.94
}
```

Resolver 只负责识别操作和范围，不负责生成文案。

#### 解析规则

- 明确提到标题，只授权标题字段。
- 明确提到摘要，只授权摘要字段。
- 明确提到正文、开头、结尾或段落，只授权正文字段。
- 明确提到话题或关键词，只授权 topics。
- 未点名字段时默认修改正文。
- 同时点名多个字段时可以授权多个字段，但必须记录在 `targetFields`。
- 要求跨平台时，解析为 `custom_modify` 的 `cross_platform` 意图，并重新编译 PlatformSpec。
- 作用范围存在两种以上合理解释且会产生明显不同结果时，返回一个简短问题。

#### 质量门

- 只修改 `targetFields`。
- 未点名字段完全保留。
- 用户要求与事实边界冲突时，事实边界优先。
- 跨平台修改必须重建结构，不能只替换平台名称。

### 7.13 统一状态机

```text
received
  -> validating
  -> resolving_context
  -> compiling_contract
  -> executing
  -> normalizing
  -> enforcing_permissions
  -> verifying
       -> repairing -> verifying（最多两轮）
  -> versioning
  -> completed
```

终止状态：

```text
completed
needs_input
no_change
failed
cancelled
conflict
```

状态规则：

- `needs_input`：只有缺少完成操作的关键信息时使用。
- `no_change`：润色或修改没有可接受差异。
- `conflict`：选区或父版本已过期。
- `failed`：技术重试和质量修复耗尽。
- 所有失败状态必须保留当前内容和用户输入。

### 7.14 自动重试策略

技术重试与质量修复分开计数。

| 类型 | 条件 | V1 上限 |
|---|---|---:|
| 技术重试 | 网络错误、5xx、空响应、无效 JSON | 1 |
| 差异重试 | 换一批或修改结果与当前版本相同 | 2 次模型调用总量内 |
| 质量修复 | 事实、平台、字段权限或操作质量门失败 | 2 |

MUST：

- 每轮重试必须带入上一轮具体失败原因。
- 不允许原样重复同一个 Prompt 后声称已修复。
- 非授权字段变化由服务端直接覆盖，不需要模型重试；如果授权字段也不合格，再进入修复。
- 最后一轮失败后不覆盖用户当前内容。
- 前端只显示最终状态，不要求用户重新点击确认。

### 7.15 质量体系

质量报告由三部分组成：

```text
CommonQuality（事实、安全、来源隔离）
+ PlatformQuality（平台格式与表达）
+ OperationQuality（本次操作是否正确）
= FinalQualityReport
```

统一报告新增：

```json
{
  "operationCheck": "pass",
  "fieldPermissionCheck": "pass",
  "differenceCheck": "pass",
  "semanticPreservationCheck": "pass",
  "protectedTermsCheck": "pass",
  "unauthorizedChangedFields": [],
  "lostFactIds": [],
  "newUnsupportedClaims": [],
  "operationIssues": []
}
```

阻断条件：

- 新增无依据事实。
- 丢失 MUST 保留事实。
- 修改非授权字段且无法恢复。
- 当前标题和新正文核心主张冲突。
- 选区内容版本过期。
- 输出结构不完整。

### 7.16 变更记录与版本

每次成功操作产生新 `resultId`，并引用 `parentResultId`。

操作记录至少保存：

```json
{
  "operationId": "operation_uuid",
  "operation": "polish",
  "operationSpecVersion": "2026.08-v1",
  "platformSpecVersion": "2026.08-v3",
  "parentResultId": "previous_result_uuid",
  "resultId": "new_result_uuid",
  "changeSet": {},
  "qualityReport": {},
  "attempts": {},
  "createdAt": "ISO timestamp"
}
```

V1 版本策略：

- 成功应用 AI 修改前，自动保存当前版本。
- 失败、取消和 `no_change` 不创建内容版本，但保存匿名错误计数。
- 用户点击“撤销”时恢复 `parentResultId`，不再调用模型。
- 撤销后继续修改会创建新的版本分支；V1 界面仍按时间顺序展示。

### 7.17 UX

#### 首次生成

保持现有“理解任务 -> 选择方向 -> 生成结果”流程。

#### 换一批

- 标题和正文各保留自己的“换一批”按钮。
- 点击后立即执行。
- 操作区域显示进度，不用弹窗。
- 成功提示必须说明关联关系：
  - “已根据当前正文更换标题”。
  - “已根据当前标题更换正文”。

#### AI 润色

正文标题栏增加 `AI 润色` 下拉按钮：

```text
正文  [跟随当前标题]       正在编辑  [AI 润色 v] [换一批]
```

菜单包含：去 AI 味、更自然、精简重复、优化逻辑、当前平台风格、自定义要求。

选中文字时，范围自动切换为“选中内容”，并显示轻量浮动工具条：

```text
[润色] [精简] [更自然] [更多]
```

成功后：

```text
已润色，调整了 6 处表达    [撤销] [查看对比]
```

不使用每次确认的对比弹窗。用户主动点击“查看对比”时再显示差异。

#### 自定义修改

继续使用底部 AI 输入框。系统解析范围后直接执行。只有范围真正不明确时才追问。

### 7.18 API 与兼容迁移

#### 新统一入口

```http
POST /api/content-operations
```

该接口只接受结构化 OperationRequest。

富文本逐字改写使用：

```http
POST /api/content-operations/stream
Accept: text/event-stream
```

SSE 事件顺序固定为：

```text
started -> delta* -> verifying -> completed
                         \\------> error
```

同一条流中的所有事件必须使用同一个 `operationId`。`delta` 至少包含 `field`、`delta` 和 `index`；`completed` 返回与非流式统一入口完全相同的 OperationResponse。

#### 现有接口

V1 保留：

```text
POST /api/generate
POST /api/modify
```

它们变为适配器：

```text
/api/generate -> operation=generate
/api/modify + 明确 action -> 对应 OperationSpec
/api/modify + 聊天文本 -> OperationResolver -> custom_modify
```

迁移完成后，前端按钮全部调用 `/api/content-operations`。旧接口保留一个兼容周期，测试不得再直接验证旧正则分支。

### 7.19 后端模块

| 模块 | 职责 |
|---|---|
| `operation-specs.js` | 保存五种版本化 OperationSpec |
| `operation-resolver.js` | 把聊天指令解析为 operation、scope 和 targetFields |
| `contract-compiler.js` | 合并 TaskBrief、StrategySpec、PlatformSpec 和 OperationSpec |
| `operation-engine.js` | 统一状态机、调用、重试和结果交付 |
| `field-permissions.js` | 覆盖非授权字段并校验 preservedFields |
| `change-set.js` | 计算字段差异、哈希和选区变化 |
| `quality.js` | 增加 OperationQuality 检查 |
| `content-engine.js` | 保留模型调用与内容标准化，逐步移除操作正则 |
| `store.js` | 保存 operation 元数据、父结果和 changeSet |

### 7.20 前端状态

前端增加：

```js
{
  activeOperation: null,
  operationScope: null,
  operationProgress: null,
  lastChangeSet: null,
  undoResultId: null
}
```

规则：

- 同一文案同一时间只允许一个 AI 操作。
- 手工输入可以继续保留，但 AI 操作执行期间不能提交另一项 AI 操作。
- 请求开始时记录当前 resultId 和正文哈希。
- 响应父版本不匹配时不应用结果。
- 操作结束后清除旧错误提示。

### 7.21 非功能要求

#### 性能

- 本地字段权限校验和 changeSet 计算应在 100ms 内完成。
- V1 必须支持富文本逐字流式改写。服务端通过 SSE 依次发送 `started`、`delta`、`verifying`、`completed` 或 `error` 事件。
- `delta` 只写入只读的流式候选层，不直接覆盖当前正式内容；只有 `completed` 通过字段权限、事实、平台和 OperationQuality 检查后，才原子替换 TipTap 编辑器内容。
- 首个 `delta` 的本地目标为请求建立后 1 秒内出现；模型不支持原生 token stream 时，服务端可以把已经验证的候选正文按字符分片发送，但必须保持相同事件合同。
- 操作接口支持 AbortSignal 取消。

#### 富文本与并发安全

- 前端使用 TipTap 作为富文本编辑器内核，支持段落、两级标题、粗体、斜体、无序列表、有序列表、引用、撤销和重做；不得自行实现 selection 或 HTML 解析。
- Markdown 是 API 与存储的 canonical format，富文本 HTML 仅是编辑器视图状态。
- 整篇和选区润色均可流式展示；选区请求必须包含 `start`、`end`、`selectedText` 与请求时 `bodyHash`。
- 服务端重新计算当前正文哈希。哈希或 `parentResultId` 不一致时返回 `409 CONTENT_STALE`，不得应用候选结果。
- 用户取消时立即停止展示流式候选，保留操作前的正式内容，不创建版本。
- 流式操作期间用户仍可复制和滚动，但编辑器进入只读状态，避免候选结果覆盖新的手工输入。

#### 安全

- API 不返回模型密钥、完整 Prompt 或本地路径。
- 日志只保存 operation、状态、耗时和错误码，不保存未脱敏正文。
- 用户文本中的指令不能覆盖系统事实边界和字段权限。

#### 可维护性

- 新增操作必须通过注册 OperationSpec 完成。
- OperationSpec 使用结构校验，缺字段时服务启动失败。
- Prompt 只使用编译后的合同，不在路由层拼接业务规则。

### 7.22 错误码

| HTTP | code | 用户行为 |
|---:|---|---|
| 400 | `INVALID_OPERATION` | 保留内容，提示重新操作 |
| 400 | `INVALID_SCOPE` | 保留内容，重新选择范围 |
| 404 | `TASK_NOT_FOUND` | 重新分析任务 |
| 409 | `CONTENT_STALE` | 保留新编辑内容，不应用旧结果 |
| 422 | `NEEDS_INPUT` | 回答最多两个关键问题 |
| 422 | `NO_ACCEPTABLE_CHANGE` | 保留原文，可换一种润色目标 |
| 500 | `OPERATION_FAILED` | 系统已自动重试，保留当前内容 |

`TASK_NOT_FOUND` 只阻断依赖已确认策略的首次生成。已有 `currentContent` 的换标题、换正文、润色和自定义修改必须降级到当前正文基线，不要求用户重新分析。

### 7.23 验收测试

#### 公共合同

1. 每个操作都有有效 OperationSpec 和版本号。
2. writableFields 与 preservedFields 无重叠。
3. 非授权字段被模型修改时，最终结果仍与请求一致。
4. 每个成功结果包含 operation、父结果、changeSet 和质量报告。
5. 结果与父版本无差异时，不返回虚假 completed。

#### 首次生成

1. 四个平台均按各自 outputSchema 返回。
2. 信息不足时最多追问两个问题。
3. 小红书话题不会混入公众号和通用文案。

#### 换标题

1. 正文、摘要和话题逐字保留。
2. 新标题以当前正文为准。
3. 第一轮返回旧标题时自动重试。
4. 新标题引入正文外功能时阻断并修复。

#### 换正文

1. 标题数组和选中标题逐字保留。
2. 摘要和话题逐字保留。
3. 新正文围绕当前选中标题。
4. 第一轮正文无变化时自动重试。

#### AI 润色

1. `de_ai` 删除已知模板句但不增加新事实。
2. `natural` 不自动添加网络黑话和虚构口语。
3. `concise` 保留所有 MUST 事实。
4. `logic` 不把时间先后改写成因果关系。
5. 整篇润色不修改标题、摘要和话题。
6. 选区润色只替换选区。
7. 正文哈希过期时返回 409。
8. 没有明确问题时返回 no_change。

#### 自定义修改

1. “换个开头”只修改正文开头。
2. “把第二个标题改短”只修改指定标题。
3. “补充两个话题”只修改 topics。
4. “改成知乎文章”重新编译 PlatformSpec。
5. 指令范围存在重大歧义时只问一个问题。

#### 端到端

1. 用户首次生成后换标题，再换正文，再润色，事实 ID 始终一致。
2. 每一步都可以撤销到直接父版本。
3. 连续操作期间旧响应不能覆盖用户的新编辑。
4. 桌面和移动端操作状态不遮挡正文或其他按钮。
5. 富文本正文可编辑标题、粗体、斜体、列表和引用，保存后仍以 Markdown 恢复相同结构。
6. 整篇或选区润色会逐字显示只读候选；`completed` 前正式正文保持不变。
7. SSE 依次出现 `started`、至少一个 `delta`、`verifying` 和 `completed`，且 `operationId` 一致。
8. 用户在流式过程中点击停止，不应用候选、不创建成功版本。
9. 流式请求建立后正文发生变化时返回 `CONTENT_STALE`，不覆盖用户手工内容。

### 7.24 Assumptions

1. V1 主要使用 DeepSeek，模型能够稳定返回结构化 JSON。
2. 当前 TaskBrief 和 FactSet 足以支持公共事实检查。
3. 当前正文可以在缺少原始资料时作为润色的受保护语义基线。
4. 用户更希望操作立即执行并支持撤销，而不是每次先看确认弹窗。
5. V1 的字符串级 changeSet 足够支持撤销和基础差异查看。

待验证：

- 用户是否经常需要同时修改标题和正文。
- 用户在富文本中更常对整篇还是选区执行润色。
- 用户更常用“去 AI 味”还是“更自然”。
- 20% 默认长度变化范围是否适合所有内容类型。

## 8. Release

### 8.1 V1 范围

- 五种 OperationSpec。
- 统一 OperationRequest 与 OperationResponse。
- `executeContentOperation` 状态机。
- 字段权限和 changeSet。
- 公共、平台、操作三层质量报告。
- 技术重试、差异重试和质量修复。
- 新 `/api/content-operations`。
- 现有 API 兼容适配器。
- AI 润色整篇与选区入口。
- 操作前版本、撤销和基础差异查看。
- 四平台乘五操作自动化测试。
- TipTap 富文本正文编辑、选区润色与逐字 SSE 候选层。
- 流式取消、正文哈希冲突保护和原子应用。

### 8.2 实施阶段

#### 阶段 A：合同基础

预计占总周期约 30%。

- 建立 OperationSpec 注册表和结构校验。
- 建立请求、响应和字段权限模块。
- 把现有 generate、换标题和换正文接入统一执行器。
- 保持现有界面行为不变。

完成标准：现有测试全部通过，三个操作不再由 Prompt 文本决定字段权限。

#### 阶段 B：润色与自定义修改

预计占总周期约 40%。

- 实现六种润色预设。
- 实现整篇和选区范围。
- 实现 OperationResolver。
- 增加 AI 润色 UI、进度、撤销和差异入口。

完成标准：润色和自定义修改的字段泄漏为 0，事实黄金用例通过。

#### 阶段 C：质量、版本与闭环验证

预计占总周期约 30%。

- 增加 OperationQuality。
- 保存 operation 元数据与 parentResultId。
- 完成自动重试、冲突处理和取消。
- 完成四平台乘五操作的端到端验证。

完成标准：本 PRD 7.23 的全部 V1 验收用例通过。

### 8.3 后续版本

- 标题、摘要和话题的独立润色入口。
- 逐句接受或拒绝修改。
- 更精确的语义级差异视图。
- 品牌 VoiceSpec。
- 多平台一次生成后分别继续修改。
- 基于人工确认差异优化建议规则。
- OperationSpec 迁移为版本化 JSON 或 YAML。

### 8.4 发布门槛

以下条件全部满足才能交付：

1. 五类操作全部进入统一执行器。
2. 所有字段权限测试通过。
3. 润色新增无依据事实为 0。
4. 自动重试、取消、过期响应和撤销通过端到端测试。
5. 现有 173 项测试无回归。
6. 生产构建通过。
7. 桌面与移动端完成浏览器截图检查。
