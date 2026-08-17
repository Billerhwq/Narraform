# Load-bearing Flows

## Create and edit content

Actor: local user. Precondition: API is reachable. Success: a complete revision is saved.

1. Browser sends the brief and optional `materialSetId`.
2. API loads approved evidence and derives a task brief plus strategies.
3. User selects a strategy; the content operation streams field deltas.
4. Server validates field permissions, facts and platform rules.
5. Only a completed operation creates a formal version; manual edits use optimistic revision checks.

Boundary and deny cases: browser input is untrusted; unknown material/task/content IDs return 404; stale revisions return 409; aborted streams do not save a formal half-result.

## Analyze materials

Actor: local user. Precondition: supported type and size. Success: evidence has source and locator metadata.

1. API stores the file locally and creates a persistent queued item.
2. Background worker parses text or calls the vision adapter.
3. Image observations remain unusable for public claims until user confirmation.
4. User can correct, ignore, retry or delete an item.

Boundary and deny cases: file size and item count are enforced server-side; asset reads are constrained to the material asset root; vision failure becomes a partial result, not a fabricated observation.

## Deliver a platform draft

Actor: local user. Precondition: immutable package passes preflight. Success: verified remote draft receipt.

1. Package builder binds content ID, revision, platform Spec version and assets.
2. Persistent job probes adapter capabilities and login status.
3. Draft is submitted with an idempotency key.
4. Adapter must perform remote lookup and return verification evidence.
5. API persists `delivered` only for `verified=true`; otherwise it stores `uncertain` or failure.

Boundary and deny cases: direct publish requires explicit confirmation and adapter capability; expired login stops before submission; connector failure is isolated per platform; three consecutive adapter failures open a platform-specific circuit.

## Learn from performance

Actor: local user. Precondition: content revision exists. Success: an approved, scoped learning rule is available to the next strategy.

1. User manually enters metrics or requests a connector sync.
2. API preserves raw metrics and derives normalized values with formulas.
3. Only comparable platform/goal/type samples form a baseline; fewer than five samples yields no insight.
4. Insight uses correlation language and remains proposed.
5. User approval creates an expiring rule; the user can edit, disable or exclude it for one task.

Boundary and deny cases: receipt/content mismatch returns 409; connector failure creates no snapshot; unapproved rules never enter strategy context.

## Delete user data

Content deletion cascades to packages, jobs, receipts, performance snapshots, insights and related learning rules. Material deletion removes stored files and analysis jobs. Receipt and snapshot deletion also remove dependent feedback records.

