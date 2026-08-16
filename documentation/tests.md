# Verification Map

## Existing coverage

| Use case | Rule and negative case | Evidence | Status / gate |
|---|---|---|---|
| Content operations | Only writable fields change; stale revisions fail | `operation-engine.test.js`, `roadmap-content-state.test.js` | Existing, `npm test` |
| Stream/save | Formal version is created only after completed operation | `operation-engine.test.js` | Existing, `npm test` |
| Materials | Image observation is not a claim before confirmation; parser failure is isolated | `roadmap-material-understanding.test.js` | Existing, `npm test` |
| Delivery | Unverified submission is not delivered; duplicate submit reuses draft | `roadmap-publish-delivery.test.js` | Existing, `npm test` |
| Adapter failure | Login expiry stops submit; DOM change is isolated; repeated failure opens circuit | `roadmap-reliability.test.js` | Existing, `npm test` |
| Feedback | Fewer than five samples yields no insight; approval is required | `roadmap-feedback-loop.test.js` | Existing, `npm test` |
| End-to-end | Material through next-task learning context | `roadmap-full-chain.test.js`, `e2e-roadmap-v1.mjs` | Existing, unit/integration + guarded browser |
| Visual | Desktop and mobile flow has no console error or horizontal overflow | `e2e-roadmap-v1.mjs`, `screenshots/roadmap-v1/` | Existing, guarded browser |
| Autosave storage | 20 revisions have P95 below 800 ms | `roadmap-reliability.test.js` | Existing, `npm test` |

## Proposed tests

| Use case | Expected behavior | Type |
|---|---|---|
| Real Xiaohongshu draft | Save draft, query remote draft list, match remote ID/title | Guarded live; blocks M3 |
| Real connector version drift | Unsupported platform DOM/version returns explicit failure and opens no false receipt | Guarded live |
| Cold production bundle | First interactive creation surface below 2.5 s on target hardware/network | Automated browser performance |
| Model stream SLA | First visible field delta below 1 s after provider starts responding | Instrumented integration |
| Multi-instance storage | Concurrent writers do not lose updates | Required only after database migration |

## Gaps

1. Real Xiaohongshu draft verification is unverified because the current browser session is logged out and the installed Skill has no draft-save/list-lookup command.
2. The 2.5 s first-screen and 1 s first-delta limits need representative production hardware/provider measurements; local functional E2E is not sufficient evidence.
3. There is no authorization denial test because the MVP has no authentication. Remote deployment is blocked until this changes.

