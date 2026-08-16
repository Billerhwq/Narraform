# Feedback Loop Spec v1

## 1. PerformanceSnapshot

```json
{
  "snapshotId":"perf_01",
  "contentId":"cnt_01",
  "contentRevision":8,
  "receiptId":"rcpt_01",
  "platform":"xiaohongshu",
  "capturedAt":"2026-08-18T08:00:00Z",
  "ageHours":48,
  "source":"platform_api|browser|manual",
  "rawMetrics":{},
  "normalizedMetrics":{},
  "dataQuality":"complete|partial|estimated"
}
```

快照不可覆盖；同一发布时间点重复采集可去重。手工录入必须保留操作者输入和时间，不做伪精确补值。

## 2. 指标映射

| 统一指标 | 小红书 | 知乎 | 公众号 |
|---|---|---|---|
| `exposures` | 曝光 | 展现 | 送达/曝光（按可用接口） |
| `reads` | 浏览 | 阅读 | 阅读 |
| `likes` | 点赞 | 赞同 | 点赞/在看分别保留 |
| `saves` | 收藏 | 收藏 | 收藏（若可用） |
| `comments` | 评论 | 评论 | 留言 |
| `shares` | 分享 | 分享 | 转发 |

不得把缺失值写为 0。派生指标例：`saveRate = saves / max(reads, exposures)`，必须随结果返回具体公式。

## 3. 比较组

基线选择必须同时满足：

- 相同平台。
- 相同主要目标，如 `awareness/save/discussion/conversion`。
- 相同内容类型或策略角度相似。
- 发布时间在最近 30-90 天，且内容年龄接近。
- 有效样本至少 5 条；不足时 `baselineStatus=insufficient`。

## 4. RetrospectiveInsight

```json
{
  "insightId":"ins_01",
  "observation":"收藏率高于同目标内容中位数",
  "evidence":["当前 5.11%","基线中位数 2.84%","样本 12 条"],
  "hypothesis":"以完整工作流组织正文，可能提升了内容的可留存性",
  "recommendation":"下一篇同类产品介绍可继续保留步骤清晰的工作流结构",
  "scope":{"platform":"xiaohongshu","goal":"save","contentType":"product_marketing"},
  "confidence":"medium",
  "causalClaim":false,
  "status":"proposed|approved|dismissed"
}
```

输出必须用“可能、信号、值得继续验证”，不得把相关性描述为因果。没有比较组时只陈述数据，不给策略结论。

## 5. LearningRule

只有用户批准后创建：

```json
{
  "ruleId":"lr_01",
  "sourceInsightId":"ins_01",
  "rule":"面向独立开发者的小红书产品介绍，优先提供一条可检查的完整工作流",
  "appliesWhen":{"platform":"xiaohongshu","contentType":"product_marketing","audienceContains":"独立开发者"},
  "priority":"suggestion",
  "expiresAt":"2026-11-16T00:00:00Z",
  "status":"active"
}
```

规则只是策略候选上下文，不能覆盖用户要求、事实边界或平台硬限制。每次采用时在策略页可见并可取消。

## 6. 完整示例

### 输入快照

```json
{
  "contentId":"cnt_codeloop_xhs_01",
  "contentRevision":8,
  "receiptId":"rcpt_xhs_82941",
  "platform":"xiaohongshu",
  "capturedAt":"2026-08-18T08:12:42Z",
  "ageHours":48,
  "source":"manual",
  "rawMetrics":{"impressions":18420,"reads":15107,"likes":612,"saves":941,"comments":83,"shares":126},
  "dataQuality":"complete"
}
```

### 标准化结果与复盘

```json
{
  "normalizedMetrics": {
    "exposures":18420,
    "reads":15107,
    "likes":612,
    "saves":941,
    "comments":83,
    "shares":126,
    "saveRate":{"value":0.06229,"formula":"saves / reads"}
  },
  "baseline": {
    "status":"available",
    "sampleSize":12,
    "windowDays":30,
    "saveRateMedian":0.0341,
    "percentile":83
  },
  "insight": {
    "observation":"这篇内容的收藏率高于近 30 天同目标内容中位数",
    "evidence":["当前 6.23%","中位数 3.41%","同类样本 12 条"],
    "hypothesis":"工作流式正文可能更方便读者保存后复用",
    "recommendation":"下一篇同类内容继续测试“问题—流程—边界”的结构，同时更换标题角度验证",
    "confidence":"medium",
    "causalClaim":false,
    "status":"proposed"
  }
}
```

## 7. 错误与降级

| 错误码 | 行为 |
|---|---|
| `METRIC_SOURCE_UNAVAILABLE` | 提供手工录入 |
| `METRIC_MAPPING_UNKNOWN` | 保存原始指标，不生成派生指标 |
| `BASELINE_INSUFFICIENT` | 只展示原始表现 |
| `RECEIPT_NOT_VERIFIED` | 允许记录，但标记发布关联待确认 |
| `LEARNING_RULE_CONFLICT` | 展示冲突，不自动覆盖旧规则 |

## 8. 验收用例

- 缺失 reads 时不把收藏率算成 0。
- 样本 4 条时不生成高低趋势。
- 小红书收藏与知乎赞同不直接跨平台比较。
- 用户驳回建议后不进入策略上下文。
- 规则过期或停用后不再影响新任务。
# 指标连接器与删除补充合同

`POST /api/performance-snapshots/sync` 调用统一指标连接器。连接器必须返回 `metrics`，来源只允许映射为 `platform_api` 或 `browser`；同步失败不创建空快照，UI 保留正式的手工录入路径。

用户可删除单条表现快照或发布回执。删除快照时同步删除由它产生的复盘洞察和已批准经验；删除回执时同步清理绑定该回执的表现链，确保已删除数据不再进入策略上下文。

