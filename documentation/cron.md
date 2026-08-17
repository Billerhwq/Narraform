# Background Work

There is no time-based cron. Two persistent background queues resume when the API starts.

| Job | Trigger | Function | Idempotency/recovery | Failure boundary |
|---|---|---|---|---|
| Material analysis | Upload/text/URL accepted with 202 | `runMaterialAnalysisJob` | Stored job/items; queued and processing jobs resume | One item can be partial/failed without failing all items |
| Delivery | User submits package IDs with 202 | `runDeliveryJob` | Package/platform/revision idempotency key; running jobs resume | One platform fails independently; circuit breaker limits repeated calls |

There is no separate worker authentication because workers run in the API process. Last runs and sanitized adapter events are available through job events and `/api/runtime-events`.

