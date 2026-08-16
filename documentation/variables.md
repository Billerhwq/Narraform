# Variables and Secrets

| Name | Used by | Scope | Source | Rotation | Risk |
|---|---|---|---|---|---|
| `DEEPSEEK_API_KEY` | Content generator | Server | Environment | Provider console | Model access and cost |
| `CONTENTFLOW_MODEL_MODE` | Content generator | Server | Environment | Not secret | Selects provider/fallback behavior |
| `NARRAFORM_VISION_API_URL` | Vision adapter | Server | Environment | Endpoint change | External data boundary |
| `NARRAFORM_VISION_API_KEY` | Vision adapter | Server | Environment | Provider console | Vision access and cost |
| `NARRAFORM_VISION_MODEL` | Vision adapter | Server | Environment | Not secret | Adapter version identity |
| `NARRAFORM_DELIVERY_ADAPTER_URL` | Delivery adapter | Server | Environment | Endpoint change | External platform side effects |
| `NARRAFORM_DELIVERY_ADAPTER_KEY` | Delivery adapter | Server | Environment | Connector operator | Draft/publish authority |
| `NARRAFORM_DELIVERY_MODE` | Delivery adapter | Server | Environment | Not secret | `sandbox` must never be production proof |
| `NARRAFORM_METRIC_ADAPTER_URL` | Metric adapter | Server | Environment | Endpoint change | Platform metric access |
| `NARRAFORM_METRIC_ADAPTER_KEY` | Metric adapter | Server | Environment | Connector operator | Metric access |
| `NARRAFORM_METRIC_ADAPTER_VERSION` | Runtime telemetry | Server | Environment | Not secret | Connector compatibility evidence |
| `CONTENTFLOW_DATA_DIR` | Repositories | Server | Environment | Not secret | Controls local data location |

No secret is intentionally exposed through Vite or bundled client code. Health responses return only configured/not-configured flags.

Pre-go-live: use a non-sandbox data directory, configure connector keys through the host secret store, verify logs contain no content or tokens, rotate test credentials, and complete a real remote draft lookup.

