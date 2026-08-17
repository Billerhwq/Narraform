# Four-stage PR Delivery Plan

The implementation is delivered as a stacked review sequence because later stages depend on the stable content state from PR-01.

| PR | Suggested branch | Base | Primary code boundary | Acceptance gate |
|---|---|---|---|---|
| PR-01 | `codex/pr-01-content-engine` | `main` | content operation/state, rich editor, app shell, drawers | unit + content operation E2E + build |
| PR-02 | `codex/pr-02-material-understanding` | PR-01 | material service/store/page/tests | seven sources, evidence contract, queue recovery |
| PR-03 | `codex/pr-03-draft-delivery` | PR-02 | package/delivery/runtime adapter/page/tests | sandbox contract + production no-false-success + guarded live draft |
| PR-04 | `codex/pr-04-feedback-loop` | PR-03 | performance/learning/page/tests | baseline protection, approval, next-task injection |

Shared route registration and navigation are integration files and therefore appear in the first stacked PR that needs them. Each stage PR includes its PRD, Spec example, prototype and test evidence. PR-03 remains merge-blocked for production until a real platform draft is remotely verified.

## Review order

1. Review PR-01 data invariants and content operations.
2. Rebase/review PR-02 on PR-01 and validate material evidence cannot silently become a claim.
3. Rebase/review PR-03 on PR-02 and validate connector side effects and receipt truthfulness.
4. Rebase/review PR-04 on PR-03 and validate learning cannot bypass user approval.

