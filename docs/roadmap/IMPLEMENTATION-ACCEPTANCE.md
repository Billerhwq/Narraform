# Narraform 四阶段实施与验收记录

**版本**：v1.0  
**日期**：2026-08-16  
**总体 PRD**：[PRD-Narraform-Overall-Roadmap.md](./PRD-Narraform-Overall-Roadmap.md)

## 1. 验收结论

| 阶段 | 代码验收 | 浏览器闭环 | 生产外部验收 |
|---|---|---|---|
| PR-01 内容引擎产品化 | 通过 | 通过 | 不依赖外部账号 |
| PR-02 全类型素材理解 | 通过 | 通过 | 视觉模型未配置时已验证诚实降级 |
| PR-03 平台草稿发布 | 通过 | 沙箱回执通过 | 待使用真实平台账号完成远端草稿反查 |
| PR-04 反馈闭环 | 通过 | 通过 | 手工指标路径已通过；平台指标连接器为可选 |

本地闭环已经连通：`MaterialSet → TaskBrief → Strategy → ContentState → PublishPackage → DeliveryReceipt → PerformanceSnapshot → RetrospectiveInsight → LearningRule → 下一次策略`。

生产门槛 M3 仍需真实账号与发布连接器。沙箱回执的 `verificationMethod` 固定为 `sandbox_draft_list_lookup`，不得描述成真实小红书、知乎或公众号送达。

## 2. PR-01 内容引擎产品化

文档：[PR-01](./PR-01-Content-Engine-Productization.md) · [Content Engine Spec](./specs/content-engine-spec-v1.md) · [高保真原型](../prototypes/phase-1-content-engine.png)

| 验收要求 | 实现证据 | 测试证据 | 状态 |
|---|---|---|---|
| 三步内得到可编辑初稿 | `src/main.jsx` 的任务理解、策略选择、流式成稿 | `scripts/e2e-roadmap-v1.mjs` | 通过 |
| 五类操作统一入口 | `server/operation-specs.js`、`server/operation-engine.js`、`POST /api/content-operations/stream` | `tests/operation-engine.test.js` | 通过 |
| 标题与正文按字段权限联动 | `server/field-permissions.js`、ChangeSet 哈希校验 | 换标题、换正文、选区润色用例 | 通过 |
| 流式、取消、内部重试 | SSE 双协议事件、`AbortController`、最多两轮质量重试 | SSE、AbortSignal、自动重试用例 | 通过 |
| 500ms 自动保存与恢复 | `src/main.jsx` 编辑序号调度；`rich-text-editor.jsx` 隔离外部同步；`server/store.js` 乐观锁 | 内容状态用例；浏览器人工编辑仅一次保存 | 通过 |
| 正式版本只保存完整结果 | 服务端在操作完成后事务保存并发送 `version.saved` | “SSE 流式操作保存一个新版本” | 通过 |
| 前端职责拆分 | 应用壳、检查抽屉、富文本画布和阶段页面分别位于独立模块 | 构建与浏览器 E2E | 通过 |

Spec 示例：

```json
{
  "operation": "regenerate_titles",
  "contentId": "cnt_codeloop_xhs_01",
  "baseRevision": 7,
  "writableFields": ["titleCandidates", "selectedTitleIndex"],
  "preserve": ["bodyMarkdown", "topics", "commentPrompt"]
}
```

预期：只产生 revision 8；正文和话题哈希不变，标题不得加入 FactSet 未支持的能力或数字。

## 3. PR-02 全类型素材理解

文档：[PR-02](./PR-02-Multimodal-Material-Understanding.md) · [Material Understanding Spec](./specs/material-understanding-spec-v1.md) · [高保真原型](../prototypes/phase-2-material-understanding.png)

| 验收要求 | 实现证据 | 测试证据 | 状态 |
|---|---|---|---|
| 七类来源进入 MaterialSet | `server/material-understanding.js` 支持 user_text、image、pdf、docx、markdown、text、url | `tests/roadmap-material-understanding.test.js` | 通过 |
| 来源可追溯 | EvidenceItem 保存 sourceId、locator、confidence | 文件与图片定位用例；浏览器来源预览 | 通过 |
| 图片观察不冒充事实 | `image_observation` 默认 `usableForClaims=false`，确认后派生新事实 | 图片确认前后 FactSet 用例 | 通过 |
| 冲突和用户修正 | revision 乐观锁、修正、忽略、冲突解决 API | 素材集契约测试 | 通过 |
| 无素材仍可创作 | 用户描述拆成 `user_claim`，质量门禁止补造证据 | 120 个跨平台生成用例与信息不足用例 | 通过 |
| 视觉不可用时诚实降级 | 未配置视觉适配器时返回 unknown，不依据文件名猜测 | “未配置视觉模型时诚实降级” | 通过 |
| 素材分析不依赖 HTTP 生命周期 | 上传返回 202；持久队列逐项解析，支持恢复、去重、单项重试和删除 | 排队、事件、失败隔离和删除用例 | 通过 |

Spec 示例：

```json
{
  "statement": "界面显示任务计划和运行测试步骤",
  "evidenceClass": "image_observation",
  "locator": { "x": 118, "y": 186, "width": 322, "height": 438 },
  "confidence": 0.92,
  "usableForClaims": false,
  "userStatus": "unreviewed"
}
```

预期：用户确认后新增带 `derivedFrom` 的 `verified_fact`，不原地篡改原始观察。

## 4. PR-03 平台草稿发布

文档：[PR-03](./PR-03-Draft-Publishing-Delivery.md) · [Publish Delivery Spec](./specs/publish-delivery-spec-v1.md) · [高保真原型](../prototypes/phase-3-draft-publishing.png)

| 验收要求 | 实现证据 | 测试证据 | 状态 |
|---|---|---|---|
| 三平台不可变发布包 | `server/publish-delivery.js` 绑定 contentRevision 和 Spec 版本 | 三平台 schema、不可变版本用例 | 通过 |
| 跨平台重新适配 | 发布包调用内容引擎按目标平台重组 | “跨平台发布包经过内容引擎适配” | 通过 |
| 发布前检查 | 小红书、知乎、公众号字段与素材 preflight | `tests/roadmap-publish-delivery.test.js` | 通过 |
| 草稿优先与手动导出 | UI 只提交 draft；可复制字段并导出含 Markdown、字段和图片的 ZIP | 浏览器发布页 E2E；构建验证 | 通过 |
| 单平台状态与失败重试 | DeliveryJob 持久后台队列、幂等键、失败项重试；UI 轮询任务状态 | 排队返回、单平台失败隔离与重复提交测试 | 通过 |
| 回执验证后才显示成功 | `verified=true` 才产生 delivered；uncertain 不显示成功 | 回执反查和未配置连接器测试 | 通过 |
| 任务内临时登录 | 连接器提供 session/login 合同；waiting_session 时显示登录入口 | 无连接器诚实降级；API 合同 | 通过（待真实连接器） |
| 适配器版本、观测与熔断 | `adapter-runtime.js` 记录脱敏事件并按平台连续失败熔断 | 登录过期、DOM 变化、失败隔离与熔断演练 | 通过 |

Spec 示例：

```json
{
  "packageId": "pkg_codeloop_xhs_r8",
  "contentId": "cnt_codeloop_xhs_01",
  "contentRevision": 8,
  "platform": "xiaohongshu",
  "target": "draft",
  "immutable": true,
  "platformSpecVersion": "2026.08-v4"
}
```

预期：连接器提交后必须反查草稿；无法确认时返回 `uncertain`。生产连接器通过 `NARRAFORM_DELIVERY_ADAPTER_URL` 接入，真实平台验收尚需账号会话。

## 5. PR-04 反馈闭环

文档：[PR-04](./PR-04-Feedback-Learning-Loop.md) · [Feedback Loop Spec](./specs/feedback-loop-spec-v1.md) · [高保真原型](../prototypes/phase-4-feedback-loop.png)

| 验收要求 | 实现证据 | 测试证据 | 状态 |
|---|---|---|---|
| 快照绑定内容版本与回执 | PerformanceSnapshot 保存 revision、receiptId 和来源 | `tests/roadmap-feedback-loop.test.js` | 通过 |
| 内容年龄不伪造 | 有回执时根据 submittedAt/capturedAt 计算；无回执时由用户输入 | 回执时间推导、负数拒绝用例 | 通过 |
| 原始与统一指标并存 | rawMetrics、normalizedMetrics、派生公式 | 缺失指标不视为 0 用例 | 通过 |
| 同类基线与最低样本 | 同平台、同目标、同类型、相近内容年龄，至少 5 条 | 样本不足和同类基线用例 | 通过 |
| 相关性而非因果 | Insight 固定 `causalClaim=false` 并使用假设措辞 | 复盘契约测试 | 通过 |
| 用户批准后才学习 | approve、dismiss、编辑、停用、过期过滤 | 策略上下文测试；浏览器批准流程 | 通过 |
| 删除内容清理学习数据 | 级联删除快照、洞察和关联规则 | “删除内容时清理表现…” | 通过 |
| 自动同步失败可回退手工录入 | 指标连接器保留 browser/platform_api 来源；失败不创建快照 | 指标连接器成功与失败用例 | 通过 |
| 用户可独立删除数据 | 素材项、回执和表现快照均有删除接口并清理下游数据 | 单项删除和级联删除用例 | 通过 |

Spec 示例：

```json
{
  "observation": "这篇内容的收藏率高于同目标内容中位数",
  "evidence": ["当前 6.23%", "中位数 3.41%", "同类样本 12 条"],
  "hypothesis": "工作流式正文可能更方便读者保存后复用",
  "causalClaim": false,
  "status": "proposed"
}
```

预期：只有用户点击“用于下次创作”后才创建 LearningRule；用户可编辑或停用，新任务只读取仍有效的 active 规则。

## 6. 验证记录

```text
npm run build
结果：通过；新增页面形成独立 roadmap-pages chunk。

npm test
结果：234 项通过，0 失败（包含取消、续传、回执时间、快照去重、忽略建议和删除级联）。

npm run test:e2e
结果：普通创作、换标题、换正文、自动保存、版本、检查和移动端导航通过；控制台错误 0，横向溢出 0。

npm run test:e2e:roadmap
结果：异步素材、内容、异步发布包、沙箱草稿回执、表现快照、学习规则和移动端无溢出全部通过。
```

浏览器证据位于 `screenshots/roadmap-v1/`：

- `01-materials-desktop.png`
- `02-content-desktop.png`
- `03-publish-preflight-desktop.png`
- `04-review-desktop.png`
- `05-learning-mobile.png`

## 7. 尚未通过的生产外部门槛

1. 配置真实发布连接器和测试账号会话。
2. 向至少一个平台保存一条草稿。
3. 使用平台草稿列表或平台 API 反查远端草稿 ID。
4. 保存 `verified=true`、真实 `verificationMethod` 和适配器版本的回执。
5. 禁止用 `sandbox_draft_list_lookup` 作为生产验收证据。

当前环境检查：`sau` 不在 PATH 中；已安装 skill 所描述的 `sau xiaohongshu upload-note` 是立即发布合同，不提供“保存草稿并远端反查”，不能替代上述验收。当前总体 Definition of Done 的真实平台条目仍为未通过。

对 `RedBookSkills` 的进一步核对发现：`check-login` 因 12 小时缓存先返回“已登录”，但直接读取创作者中心页面实际显示短信登录，说明会话已经过期；其源码只有填充预览和直接发布，没有草稿保存或草稿列表反查命令。因此当前不能安全地自动补齐 M3，也不能使用缓存登录结果作为生产验收证据。
