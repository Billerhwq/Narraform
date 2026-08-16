# Material Understanding Spec v1

## 1. 输入契约

`MaterialSet` 是一次创作任务的素材边界。

```json
{
  "materialSetId": "matset_01",
  "instruction": "一句自然语言要求",
  "items": [
    {"sourceId":"src_01","type":"image","name":"screen.png","mimeType":"image/png"},
    {"sourceId":"src_02","type":"url","url":"https://approved.example/product"}
  ]
}
```

支持类型：`user_text/image/pdf/docx/markdown/text/url`。每项限制 20MB，单组最多 20 项；网页只读取用户明确提供或批准的 URL。

## 2. 输出契约

```json
{
  "status": "ready|partial|failed",
  "imageObservations": [],
  "verifiedFacts": [],
  "userClaims": [],
  "inferences": [],
  "conflicts": [],
  "unknowns": [],
  "sourceSummaries": []
}
```

### EvidenceItem

| 字段 | 规则 |
|---|---|
| `factId` | 稳定 ID |
| `statement` | 原子陈述，只表达一件事 |
| `evidenceClass` | `verified_fact/user_claim/image_observation/inference` |
| `sourceId` | 必填 |
| `locator` | 图片矩形、页码+段落、URL+selector 或文本范围 |
| `confidence` | 0-1，仅表示提取可信度，不表示事实真实性 |
| `usableForClaims` | 是否可直接用于公开产品主张 |
| `userStatus` | `unreviewed/confirmed/corrected/ignored` |

分类规则：图片上出现“运行测试”按钮，只能得到图片观察；用户明确说明“产品可运行项目测试”才能得到可用产品主张。模型推断永远不能自动升级为强事实。

## 3. 冲突规则

- 同一属性出现不兼容值时创建 `Conflict`，不自行择一。
- 用户修正优先于用户上传资料；更新较新的官方资料优先级可作为建议，但仍保留冲突记录。
- 影响标题核心主张或 CTA 的冲突阻断生成；非关键冲突只告警。
- 忽略来源不删除原始项，只从当前 `FactSet` 排除。

## 4. 无素材降级

只有用户描述时：

- 句子按原意拆为 `userClaims`。
- 可以转写为宣传文案，不需要强迫用户提供截图或数据。
- 不得把宣传目标扩写为真实效果，不得生成客户、数量、排名、速度、价格或亲测经历。
- 可以使用“帮助、用于、支持、让流程更清楚”等非量化价值表达，但必须能回到用户描述。

## 5. 完整示例：截图 + 一句话

### 输入

```json
{
  "materialSetId": "matset_codeloop_01",
  "instruction": "这是 CodeLoop，一个能协助完成编码任务的 Agent，帮我写小红书介绍。",
  "items": [
    {
      "sourceId": "src_screen_01",
      "type": "image",
      "name": "codeloop-run.png",
      "width": 1440,
      "height": 960
    }
  ]
}
```

### 输出

```json
{
  "status": "ready",
  "userClaims": [
    {
      "factId":"f_user_01",
      "statement":"CodeLoop 是一个协助完成编码任务的 Agent",
      "evidenceClass":"user_claim",
      "sourceId":"instruction",
      "locator":{"start":0,"end":34},
      "confidence":1,
      "usableForClaims":true,
      "userStatus":"confirmed"
    }
  ],
  "imageObservations": [
    {
      "factId":"obs_01",
      "statement":"界面左侧显示任务计划，包含读取仓库、修改文件和运行测试三个步骤",
      "evidenceClass":"image_observation",
      "sourceId":"src_screen_01",
      "locator":{"x":118,"y":186,"width":322,"height":438},
      "confidence":0.92,
      "usableForClaims":false,
      "userStatus":"unreviewed"
    },
    {
      "factId":"obs_02",
      "statement":"界面中显示 4 个文件发生改动，并展示测试通过状态",
      "evidenceClass":"image_observation",
      "sourceId":"src_screen_01",
      "locator":{"x":492,"y":632,"width":760,"height":182},
      "confidence":0.88,
      "usableForClaims":false,
      "userStatus":"unreviewed"
    }
  ],
  "verifiedFacts": [],
  "inferences": [
    {
      "factId":"inf_01",
      "statement":"产品可能把任务规划、代码改动和测试放在同一流程中",
      "evidenceClass":"inference",
      "sourceId":"src_screen_01",
      "confidence":0.72,
      "usableForClaims":false
    }
  ],
  "unknowns": [
    "截图不能证明任务执行是否完全自动",
    "没有支持语言、速度提升、用户规模或价格信息"
  ],
  "conflicts": []
}
```

用户点击确认 `obs_01` 后，系统生成一条新的 `verified_fact`，保留 `derivedFrom: "obs_01"`，而不是原地篡改证据类型。

## 6. 接口行为

- 新建素材集立即返回 ID 和上传地址。
- 分析使用事件流返回逐项状态：`item.parsing`、`item.ready`、`fact.detected`、`conflict.detected`、`analysis.completed`。
- 修改事实使用 revision，冲突返回 409。
- 删除素材集时删除文件和派生文本；已发布内容只保留最小事实快照和来源已删除标记。

## 7. 错误码

| 错误码 | 说明 |
|---|---|
| `MATERIAL_TYPE_UNSUPPORTED` | 不支持的文件类型 |
| `MATERIAL_TOO_LARGE` | 超过限制 |
| `MATERIAL_PARSE_FAILED` | 单项解析失败，可重试 |
| `VISION_UNAVAILABLE` | 图片理解不可用，允许继续文本流程 |
| `EVIDENCE_CONFLICT` | 关键事实冲突待处理 |
| `MATERIAL_REVISION_CONFLICT` | 用户修正版本冲突 |

## 8. 验收用例

- 同一文件重复上传只保留一个二进制对象。
- OCR 错字不会自动成为 `verified_fact`。
- 点击事实能定位到原图矩形或文档页码。
- 删除一个失败素材后，其余素材仍可生成任务。
- 只有一句产品介绍时仍能完成生成，且无虚构数字与经历。
# 异步分析任务补充合同

素材写入采用 `202 Accepted`，不能让 OCR、文档解析或网页读取占用上传请求生命周期。

```json
{
  "materialSet": {"materialSetId":"matset_01","status":"processing","revision":2},
  "job": {"jobId":"matjob_01","status":"queued","itemIds":["src_01"]},
  "queued": [{"sourceId":"src_01","sourceType":"image","status":"queued"}],
  "duplicates": []
}
```

任务事件固定为 `analysis.queued → analysis.started → item.parsing → item.ready|item.partial|item.failed → analysis.completed`。服务重启后恢复 `queued/processing` 任务；同一 SHA-256 内容不重复入集；失败项可单独 `retry`，任意素材项可单独删除。图片观察仍必须经用户确认，不因后台任务成功而自动升级为事实。

