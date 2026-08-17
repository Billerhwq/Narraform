# Publish Delivery Spec v1

## 1. PublishPackage

发布包是内容引擎与平台适配器之间的不可变契约。

```json
{
  "packageId": "pkg_01",
  "contentId": "cnt_01",
  "contentRevision": 8,
  "platform": "xiaohongshu",
  "target": "draft",
  "fields": {},
  "assets": [],
  "platformSpecVersion": "2026.08-v4",
  "createdAt": "2026-08-16T08:00:00Z"
}
```

创建后不可修改；内容变化必须生成新 package。`target` 默认且优先为 `draft`。

## 2. 平台字段映射

| 平台 | 必需字段 | 可选字段 | MVP 送达方式 |
|---|---|---|---|
| 小红书 | title, body, images | topics | 浏览器保存图文草稿 |
| 知乎回答 | questionUrl, body | topics | 浏览器保存回答草稿 |
| 知乎文章 | title, body | cover, topics | 浏览器保存文章草稿 |
| 公众号 | title, digest, body | cover, author | API 或浏览器进入草稿箱 |

图片顺序、裁剪结果和替代文本属于发布包，不由适配器临时决定。

## 3. PreflightResult

```json
{
  "status": "pass|blocked|warning",
  "checks": [
    {"id":"xhs_title_length","status":"pass","message":"标题长度符合要求"},
    {"id":"xhs_image_count","status":"pass","message":"共 4 张图片"}
  ],
  "capabilities": {"draft":true,"directPublish":false,"verifyDraft":true}
}
```

阻断项：缺平台必需字段、超硬限制、资源不可读、平台适配器不可用。登录过期不属于内容 preflight 错误，进入 `waiting_session`。

## 4. DeliveryJob

- 每个平台一个子任务，批量任务只聚合状态。
- `idempotencyKey = sha256(packageId + platform + target)`。
- 重试沿用幂等键，不创建新远端草稿；确定远端不存在时才重新提交。
- 事件不得包含 Cookie、token、完整页面存储或用户密码。

## 5. DeliveryReceipt

| 字段 | 说明 |
|---|---|
| `receiptId` | 本地回执 ID |
| `jobId` | 交付任务 |
| `platform` | 目标平台 |
| `target` | `draft/published` |
| `status` | `delivered/uncertain/failed` |
| `remoteDraftId` | 可得时填写 |
| `remoteUrl` | 可访问时填写 |
| `verified` | 是否完成远端验证 |
| `verificationMethod` | `api_response/draft_list_lookup/url_lookup/manual` |
| `submittedAt` | 提交时间 |
| `verifiedAt` | 验证时间 |
| `adapterVersion` | 适配器版本 |

只有 `verified=true` 才在 UI 显示“已送达”。

## 6. 完整示例：小红书草稿交付

### 发布包

```json
{
  "packageId": "pkg_codeloop_xhs_r8",
  "contentId": "cnt_codeloop_xhs_01",
  "contentRevision": 8,
  "platform": "xiaohongshu",
  "target": "draft",
  "fields": {
    "title": "把一段编码任务完整交给 Agent",
    "body": "写代码时，真正耗时间的往往不只是敲下那几行……",
    "topics": ["AI编程", "独立开发", "开发工具", "编码Agent", "效率工具"]
  },
  "assets": [
    {"assetId":"asset_cover","type":"image","order":1,"sha256":"51d..."},
    {"assetId":"asset_flow","type":"image","order":2,"sha256":"a11..."},
    {"assetId":"asset_diff","type":"image","order":3,"sha256":"f92..."},
    {"assetId":"asset_test","type":"image","order":4,"sha256":"e37..."}
  ],
  "platformSpecVersion":"2026.08-v4"
}
```

### 回执

```json
{
  "receiptId":"rcpt_xhs_82941",
  "jobId":"job_xhs_0021",
  "platform":"xiaohongshu",
  "target":"draft",
  "status":"delivered",
  "remoteDraftId":"xhs_draft_82941",
  "remoteUrl":null,
  "verified":true,
  "verificationMethod":"draft_list_lookup",
  "submittedAt":"2026-08-16T08:12:31Z",
  "verifiedAt":"2026-08-16T08:12:42Z",
  "adapterVersion":"xhs-browser-1.0.0"
}
```

### 无法验证示例

```json
{
  "status":"uncertain",
  "verified":false,
  "verificationMethod":null,
  "userMessage":"内容已经提交，但暂时无法在草稿列表中确认。请打开平台草稿箱检查，系统不会自动重复提交。"
}
```

## 7. 错误码

| 错误码 | 是否可重试 | 处理 |
|---|---|---|
| `PREFLIGHT_BLOCKED` | 否 | 返回内容编辑修正 |
| `SESSION_REQUIRED` | 是 | 展示临时登录 |
| `SESSION_EXPIRED` | 是 | 重新登录后续跑 |
| `PLATFORM_RATE_LIMITED` | 是 | 按平台时间退避 |
| `ASSET_UPLOAD_FAILED` | 是 | 只重试资源上传 |
| `REMOTE_RESULT_UNCERTAIN` | 谨慎 | 先反查，不直接重投 |
| `ADAPTER_OUTDATED` | 否 | 使用手动导出兜底 |

## 8. 验收用例

- 连续双击提交只生成一个远端草稿。
- 上传第三张图失败时从第三张继续，不重传已确认资源。
- 登录过期恢复后继续原 job。
- 无验证依据时永远不显示成功。
- 关闭任意发布适配器后，Markdown 和资源包仍可导出。
# 后台队列、登录与人工兜底补充合同

`POST /api/delivery-jobs` 返回 `202 Accepted` 和 `status=queued`。后台任务按平台执行 preflight、会话检查、提交和远端反查，并在每个外部动作前后持久化；服务重启后恢复 `queued/running` 任务。重复执行使用 `packageId + platform + target` 生成稳定幂等键。

任务内登录接口为：

```text
GET  /api/platform-sessions/:platform
POST /api/platform-sessions/:platform/login
```

连接器可返回 `browserUrl/loginUrl/qrCodeUrl`，UI 在当前发布任务中引导用户完成登录。没有连接器时返回 `connector_required`，不得显示已送达。

人工兜底必须同时支持：复制当前平台字段，以及导出 ZIP。ZIP 每个平台目录至少包含 `content.md`、`fields.json` 和实际 `images/*`，不能只导出内部 JSON。

