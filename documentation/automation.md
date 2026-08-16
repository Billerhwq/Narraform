# Automation Boundaries

| Automation | Trigger/owner | Reads | May call | Output contract | Hard guardrails |
|---|---|---|---|---|---|
| Content generation | User action | Task brief, approved facts, selected Spec | DeepSeek or local generator | Complete platform content state | Fact checks, field permissions, quality gate, cancellation |
| Material vision | User upload | One image | Configured vision endpoint | Observations, OCR text, unknowns | Observations are not claims until confirmation |
| Draft delivery | User confirms save to draft | Immutable publish package | Configured platform connector | Verified/uncertain/failed receipt | Draft default, idempotency, remote verification, circuit breaker |
| Metric sync | User action | Receipt/content identifiers | Configured metric connector | Raw and normalized metrics | Connector failure creates no snapshot |
| Learning | User approval | Insight evidence and scope | No external tool | Expiring scoped rule | No silent approval; per-task exclusion and global disable |

Prompts steer wording, but they do not authorize side effects. The app owns saves, delivery confirmation, deletion and rule approval. Runtime events store operation IDs, duration, version, error category and verification method only.

