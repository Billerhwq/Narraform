# Permissions

## Current model

The MVP has one implicit local-user role and no authentication or tenant boundary. Scope is not derived from a token or database membership. This is an explicit product constraint, not an implemented permission system.

| Resource | Read | Create/update | Delete | Enforcement |
|---|---|---|---|---|
| Content and versions | Local user | Local user | Local user | API ID lookup and revision checks |
| Material sets and files | Local user | Local user | Local user | API ID lookup and asset-root path checks |
| Publish packages/jobs/receipts | Local user | Local user | Local user | API ID lookup, preflight, confirmation gates |
| Performance and learning rules | Local user | Local user | Local user | API relationship checks |
| Runtime events | Local user | Server writes only | Reset in test only | Server emits sanitized schema |

There is no row-level security. All isolation is code-enforced and only protects object consistency, not one local user from another. Before remote deployment, authentication and owner scoping are mandatory on every collection and asset route.

