# Narraform Architecture

## Product and assumptions

Narraform is a local-first content production application. A user provides a short brief and optional materials, creates platform-specific content, exports or sends a draft through an external connector, records performance, and explicitly approves reusable learning rules.

The MVP is single-user and has no account, organization, or workspace model. The API binds to `127.0.0.1`; this limits network exposure but is not authentication. Any local process that can reach the port can call the API.

## Stack and modules

| Layer | Implementation | Responsibility |
|---|---|---|
| Web | React, Arco Design, Ant Design X, Tiptap | Creation, materials, delivery, review |
| API | Express | Validation, orchestration, public error mapping |
| Content | `server/content-engine.js`, `server/operation-engine.js` | Platform generation and field-scoped operations |
| Materials | `server/material-understanding.js` | Persistent parsing queue and evidence classification |
| Delivery | `server/publish-delivery.js` | Immutable packages, preflight, delivery queue, receipts |
| Learning | `server/performance-learning.js` | Metric normalization, baselines, insights, approved rules |
| Runtime | `server/adapter-runtime.js` | Sanitized adapter telemetry and per-adapter circuit breaking |
| Storage | JSON repositories under `data/` | Content, materials, jobs, receipts, metrics and rules |

## Trust boundaries

```text
Browser -> local Express API -> local JSON/file storage
                              -> model/vision connector
                              -> platform delivery connector
                              -> platform metric connector
```

- Secrets are read only by the server process.
- Uploaded file bodies and generated content are stored locally but are not written to runtime telemetry.
- External connectors are untrusted. Their responses are validated by domain services before a success state is persisted.
- A delivery is successful only when `verified=true`; a click or submission response alone is insufficient.

## Known risks and assumptions

- No API authentication: local malware or another local user process can access the API.
- JSON storage is process-local and suitable for the MVP, not concurrent multi-instance deployment.
- Browser platform automation is not bundled as a production connector. Real Xiaohongshu draft verification remains an external acceptance gate.
- Connector circuit state is in memory; persisted runtime events survive restart, circuit state does not.
- Built JavaScript has a size warning. Roadmap pages are lazy-loaded, but the creation bundle remains above 500 kB.

No email sending. No public/indexable routes. No scheduled cron; background queues resume on API startup.

## Related documents

- [flows.md](./flows.md)
- [permissions.md](./permissions.md)
- [variables.md](./variables.md)
- [tests.md](./tests.md)
- [cron.md](./cron.md)
- [automation.md](./automation.md)

