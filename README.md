# Narraform AI 内容工作台

Narraform V1 是一个面向普通用户的对话式中文内容工作台。它支持小红书、知乎回答/文章、微信公众号和通用文案，并提供任务理解、事实隔离、三策略推荐、平台生成、质量检查、对话式编辑、版本与内容记录闭环。

> One idea. Every platform.

用户流程：

```text
输入目标和资料 → 系统整理事实 → 推荐 3 个内容方向 → 用户选择 → 按平台规范生成 → 检查、编辑和保存
```

## 运行

环境要求：Node.js 22+。

```powershell
npm install
npm run dev
```

- 前端：`http://127.0.0.1:5173/`
- API：`http://127.0.0.1:4176/`

默认生成顺序为 DeepSeek → 本地确定性生成器；结果会分别标记“AI 生成”或“本地生成”。Codex CLI 适配器仍作为可选能力保留，但默认不参与生成链路。

Codex 在独立临时目录中以 `--ephemeral` 和只读沙箱运行，不读取当前项目文件，不持久化对话，也不会读取或返回认证文件内容。使用自定义 provider 时，即使 `codex login status` 显示未登录，只要 CLI 本身可调用，仍可正常生成。

可选环境变量：

> `CONTENTFLOW_*` 是 V1 的兼容配置名，更名为 Narraform 后仍然保留，避免现有部署失效。

- `CONTENTFLOW_MODEL_MODE=codex`：显式启用 Codex，并在失败后回退 DeepSeek 和本地生成器。
- `CONTENTFLOW_CODEX_ENABLED=1`：不改变其他模型设置时，单独启用 Codex。
- `CONTENTFLOW_CODEX_PATH`：指定 Codex CLI 可执行文件。
- `CONTENTFLOW_CODEX_TIMEOUT_MS`：单次生成超时，默认 120000 毫秒。
- `CONTENTFLOW_CODEX_REASONING_EFFORT`：可选 `low`、`medium`、`high`、`xhigh`；不设置时复用本机配置。
- `CONTENTFLOW_MODEL_MODE=local`：只使用本地生成器。
- `CONTENTFLOW_MODEL_MODE=deepseek`：使用默认的 DeepSeek → 本地生成器链路。
- `DEEPSEEK_API_KEY`：配置 DeepSeek 回退。密钥只由服务端读取。
- `PLAYWRIGHT_EXECUTABLE_PATH`：可选，指定 E2E 测试使用的 Chromium/Edge 可执行文件。Windows 默认尝试使用系统 Edge。

## 验证

```powershell
npm test
npm run build
npm run test:e2e
npm run test:e2e:roadmap
```

`test:e2e` 要求前端与 API 已经运行。它会验证信息不足追问、资料读取、三策略选择、生成、自然化修改、质量检查、版本保存和重新打开；测试完成后会删除自己创建的内容记录。

`test:e2e:roadmap` 验证素材理解、平台发布包、草稿回执、表现复盘、学习规则和移动端布局。默认生产模式不会伪造平台成功；仅设置 `NARRAFORM_DELIVERY_MODE=sandbox` 时使用本地草稿适配器。

主要生成接口：

- `POST /api/tasks/understand`：生成事实卡和 3 个策略候选。
- `POST /api/tasks/:taskId/select-strategy`：保存用户选择。
- `POST /api/generate`：使用 `taskId + strategyId + PlatformSpec` 生成。
- `POST /api/modify`：保留任务事实和策略进行修改或跨平台改写。
- `POST /api/quality`：重新执行事实、平台、风险和表达检查。

## 主要目录

- `src/`：用户界面
- `server/task-understanding.js`：任务理解、事实/观点/经历分离和必要追问
- `server/strategy-engine.js`：生成三套可选择、可追溯的内容策略
- `server/platform-specs.js`：可版本化平台规则
- `server/content-engine.js`：编译 TaskBrief、StrategySpec 和 PlatformSpec，执行生成和修改
- `server/quality.js`：来源隔离、平台、AI 腔和风险检查
- `server/materials.js`：TXT、Markdown、PDF、DOCX 和网页解析
- `server/store.js`：本地任务、策略选择、内容与版本存储
- `tests/`：任务理解、平台、来源泄露、AI 腔、信息不足、质量和存储测试
- `NARRAFORM-PLATFORM-COPY-SPEC-v2.md`：当前平台文案规范

本地内容保存在 `data/`，该目录不进入 Git。

## 后续四阶段路线图

- [总体 PRD](./docs/roadmap/PRD-Narraform-Overall-Roadmap.md)
- [PR-01：内容引擎产品化](./docs/roadmap/PR-01-Content-Engine-Productization.md)
- [PR-02：全类型素材理解](./docs/roadmap/PR-02-Multimodal-Material-Understanding.md)
- [PR-03：平台草稿发布](./docs/roadmap/PR-03-Draft-Publishing-Delivery.md)
- [PR-04：反馈闭环](./docs/roadmap/PR-04-Feedback-Learning-Loop.md)
- [四阶段实施与验收记录](./docs/roadmap/IMPLEMENTATION-ACCEPTANCE.md)

运行四阶段高保真交互原型：

```powershell
npm run prototype:roadmap
```

打开 `http://127.0.0.1:5188/?phase=1`，右上角可切换四个阶段。运行 `npm run prototype:roadmap:capture` 可重新生成 PR 文档引用的四张 1440×960 原型图。
