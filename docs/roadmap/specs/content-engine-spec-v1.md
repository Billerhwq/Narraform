# Content Engine Spec v1

## 1. 规范目的

本规范定义 Narraform 内容状态及其所有变更操作。平台规则回答“内容应该长什么样”，Operation Spec 回答“本次允许改什么”，两者必须同时生效。

```text
TaskBrief + FactSet + StrategySpec + PlatformSpec
                  ↓
          Content Operation
                  ↓
       ContentState + QualityReport
```

## 2. 核心对象

### ContentState

| 字段 | 类型 | 说明 |
|---|---|---|
| `contentId` | string | 稳定内容 ID |
| `revision` | integer | 每次成功保存递增 |
| `taskId` | string | 来源任务 |
| `platform` | enum | `xiaohongshu/zhihu/wechat/generic` |
| `platformMode` | string|null | 知乎 `answer/article` |
| `strategyId` | string | 已选择策略 |
| `titleCandidates` | string[] | 候选标题 |
| `selectedTitleIndex` | integer | 当前标题 |
| `summary` | string|null | 平台摘要 |
| `bodyMarkdown` | string | 富文本的规范化 Markdown |
| `topics` | string[] | 独立话题字段，不内嵌正文 |
| `commentPrompt` | string|null | 自然互动问题 |
| `formattingProfile` | object|null | 小红书排版与 Emoji 策略 |
| `qualityReport` | QualityReport | 最后一次检查 |
| `factIds` | string[] | 使用的事实 |
| `updatedAt` | ISO8601 | 保存时间 |

### OperationRequest

```json
{
  "operationId": "op_01",
  "operation": "generate|regenerate_titles|regenerate_body|polish|custom_modify",
  "contentId": "cnt_01",
  "baseRevision": 7,
  "targetFields": ["bodyMarkdown"],
  "instruction": "更像产品团队在介绍，去掉旁观推荐口吻",
  "selectedText": null,
  "clientRequestId": "uuid"
}
```

## 3. 操作权限

| 操作 | 可写字段 | 必须保持 | 联动规则 |
|---|---|---|---|
| `generate` | 平台输出全部字段 | 任务事实 | 创建完整初稿 |
| `regenerate_titles` | 标题候选、选中索引 | 正文、摘要、话题、排版 | 新标题必须被当前正文支撑 |
| `regenerate_body` | 正文；小红书可联动话题和互动问题 | 标题候选与选中标题 | 正文必须服从选中标题 |
| `polish` | 指定文本或正文 | 主张、事实、标题、话题 | 不新增事实和承诺 |
| `custom_modify` | 解析出的目标字段 | 其他字段 | 歧义时仅追问会造成破坏性变更的范围 |

## 4. 平台规则合并

优先级从高到低：

1. 法律、安全与事实边界。
2. 用户本次明确要求。
3. Operation 字段权限。
4. Platform Spec 硬限制。
5. 已选择策略。
6. 风格偏好与自动排版。

冲突例：用户要求“换标题并补充正文”。如果点击的是标题区“换一批”，Operation 权限高于自然语言补充，正文不得修改；应把补充要求应用于标题表达。

## 5. 流式协议

SSE 使用 `event` 与 JSON `data`：

```text
event: operation.started
data: {"operationId":"op_01","attempt":1}

event: field.reset
data: {"field":"bodyMarkdown"}

event: field.delta
data: {"field":"bodyMarkdown","text":"真正让编码 Agent 好用的，"}

event: quality.completed
data: {"status":"pass","warnings":[]}

event: version.saved
data: {"contentId":"cnt_01","revision":8}

event: operation.completed
data: {"operationId":"op_01"}
```

前端收到 `field.reset` 后只清空目标字段；用户取消时丢弃未提交缓冲，保留 revision 7。

## 6. 自动重试

- 模型超时、可解析输出失败：指数退避，最多 2 次。
- 平台硬限制可自动修复：把 `autoRepairIssues` 加入下一次请求。
- 事实阻断：先删除无依据表达再重试。
- 权限越界：不重试，返回 `OPERATION_SCOPE_VIOLATION`。
- 两次失败后保留原版本，向用户显示可理解错误，不暴露 prompt、模型堆栈或内部 schema。

## 7. 完整示例：CodeLoop 小红书初稿

### 输入

```json
{
  "operation": "generate",
  "taskBrief": {
    "taskId": "task_codeloop_01",
    "instruction": "介绍 CodeLoop：它可以读取代码仓库，拆解任务，修改代码并运行测试。写一篇给独立开发者看的小红书产品介绍。",
    "contentType": "product_marketing",
    "platform": "xiaohongshu",
    "purpose": "让目标用户理解产品的工作方式",
    "audience": "需要处理重复编码任务的独立开发者",
    "subject": {"name": "CodeLoop"}
  },
  "factSet": {
    "verifiedFacts": [
      {"factId":"f1","statement":"CodeLoop 可以读取用户授权的代码仓库","sourceType":"user_claim"},
      {"factId":"f2","statement":"CodeLoop 会把编码目标拆解为执行计划","sourceType":"user_claim"},
      {"factId":"f3","statement":"CodeLoop 可以修改代码并运行项目测试","sourceType":"user_claim"}
    ],
    "unknowns": ["没有用户数量、速度提升或支持语言数据"]
  },
  "strategy": {
    "id":"strategy_workflow",
    "angle":"从一次完整编码任务的工作流解释产品",
    "tone":"产品团队的自然公开表达",
    "cta":"邀请读者说出最想交给 Agent 的任务"
  }
}
```

### 输出

```json
{
  "status": "completed",
  "result": {
    "contentId": "cnt_codeloop_xhs_01",
    "revision": 1,
    "titleCandidates": [
      "把一段编码任务完整交给 Agent",
      "CodeLoop 不只补代码，还会把任务做完",
      "从读仓库到跑测试，Agent 怎么工作"
    ],
    "selectedTitleIndex": 0,
    "bodyMarkdown": "写代码时，真正耗时间的往往不只是敲下那几行，而是先读懂仓库、判断该改哪里，再确认改动没有破坏原来的逻辑。\n\nCodeLoop 想把这条链路连起来：读取你授权的代码仓库，根据目标拆出执行计划，然后修改代码并运行项目测试。你看到的不只是一段建议，而是一条可以检查的处理过程。🧩\n\n它更适合目标已经比较明确、但执行步骤多且重复的编码任务。至于速度提升、支持语言和实际效果，目前没有资料支撑，我们不会替你补上这些数字。\n\n如果有一件编码任务可以交给 Agent，你最想先交出哪一步？",
    "topics": ["AI编程", "独立开发", "开发工具", "编码Agent", "效率工具"],
    "commentPrompt": "你最想先把哪一步交给编码 Agent？",
    "factIds": ["f1", "f2", "f3"],
    "qualityReport": {"status":"pass","blockingErrors":[],"warnings":[]}
  }
}
```

### 换标题输入与约束

```json
{
  "operation": "regenerate_titles",
  "contentId": "cnt_codeloop_xhs_01",
  "baseRevision": 1,
  "currentResultHash": {
    "bodyMarkdown": "sha256:ad7c...",
    "topics": "sha256:0c61..."
  }
}
```

输出的 `bodyMarkdown` 与 `topics` 哈希必须完全一致，标题不得出现“提效 10 倍”“全自动开发”等正文与事实集未支撑的主张。

## 8. 错误码

| 错误码 | HTTP | 用户行为 |
|---|---:|---|
| `CONTENT_NOT_FOUND` | 404 | 返回内容列表 |
| `CONTENT_REVISION_CONFLICT` | 409 | 拉取新版本并比较 |
| `OPERATION_SCOPE_VIOLATION` | 422 | 保持原稿，解释未修改原因 |
| `QUALITY_BLOCKED` | 422 | 展示可修复问题 |
| `STREAM_INTERRUPTED` | 503 | 自动重试或恢复原稿 |
| `MODEL_UNAVAILABLE` | 503 | 切换本地生成或稍后重试 |

## 9. 验收用例

- 固定正文换标题 20 次，正文哈希不变。
- 固定标题换正文 20 次，每次正文核心主张与标题一致。
- 润色前后事实 ID 集合不增加，数字和产品能力不新增。
- 流式中途取消、断网、刷新均不会覆盖最后完整版本。
- 自定义编辑后 500ms 自动保存，revision 单调递增。
# 幂等保存补充合同

客户端为每次内容操作生成稳定 `operationId`，重试时复用同一值。服务端保存版本前检查内容历史：同一 `contentId + operationId` 已保存时返回当前正式内容并标记幂等重放，不新增 revision；不同操作仍受 `baseRevision` 乐观锁保护。

