# Alhijrah Caseflow

Production immigration case-management platform. The existing architecture is preserved:

- Railway runs the Node.js application and API.
- Supabase Auth provides user identities and sessions.
- Supabase PostgreSQL stores operational records and audit history.
- Cloudflare R2 stores private documents; only short-lived signed URLs reach the browser.

## Authentication and authorization

Browser users authenticate through `POST /api/v1/auth/login`. Access and refresh tokens are stored only in Secure, HttpOnly, SameSite=Strict cookies. Every API route performs server-side permission checks.

`X-API-Key` remains available only for trusted server-to-server operations. It must never be placed in browser code.

Production roles are Owner, Admin, Supervisor, Case Manager, Form Preparer, Document Reviewer, Translator, Attorney / Accredited Representative, Billing, Auditor, Client Owner, and Client Collaborator. Owner has all permissions.

Roles are the starting point, not the whole model. Access is resolved per request from Owner-recorded policy — see **Effective authorization** below. Only an existing Owner may grant or remove the Owner role, or alter an Owner's account.

## Effective authorization

**Nothing narrows by default.** With no policy stored, every staff member's scope is `global`, which is exactly the access they had before this model existed. `20260824040000_authorization_model.sql` creates the policy tables empty, so applying it changes nobody's visibility. Narrowing anyone is an Owner action taken in the Access Control view.

Effective access is resolved in layers, each able to add or remove, later winning:

```
role defaults  ->  role policy  ->  team policies  ->  user policy
```

So a user-level grant overrides a team-level restriction, and a user-level restriction overrides a role default. Record-level grants and restrictions apply on top. The Owner is outside the system: no restriction applies to the Owner role, and a policy claiming to limit it is refused at the API.

Each module (`cases`, `documents`, `tasks`, `deadlines`, `billing`, `audit`, `reports`, `portal`, …) is scoped independently:

| Scope | Reaches |
| --- | --- |
| `global` | every record — the default for staff |
| `team` | records belonging to a team the user is on |
| `assigned` | records assigned to the user via `case_assignments` (legacy `assigned_to` labels still match) |
| `explicit_client` | only clients granted explicitly |
| `explicit_case` | only cases granted explicitly |
| `client_self` | only the user's own client — the default for portal roles |

Explicit record grants widen beyond the configured scope; explicit record restrictions remove a case or client however wide the scope is. A grant may carry its own permission list, so one case can be handed over for viewing without opening the module.

The model is enforced on case listing and direct UUID reads, case writes, document listing, presigning, upload confirmation, signed download URLs, document review and deletion, and the audit trail. Listings narrow in the query where the scope allows and are filtered again per row, so a bug in the query filter cannot widen access. An unreachable record reports 404 rather than 403, so a response does not confirm that an id exists.

Portal principals default to `client_self` and reach a case only through an active `client_access` row. Granting a portal user `cases.view` widens their permission, not their scope.

Operational notes: policy is cached in-process for 10 seconds and invalidated on write, so behind more than one instance a change can take that long to propagate everywhere. If the authorization tables are absent (migration not yet applied), the resolver falls back to role defaults with global scope — the pre-migration state — rather than locking the firm out; any other failure fails closed.

## Core capabilities

- Clients, family members, and relationships
- Cases, service catalog, assignments, workflow and review states
- Versioned, service-specific intake with draft autosave and final review
- Private R2 document upload, signed download, replacement and review metadata
- Document requests, tasks, deadlines and audit events
- Team invitations, role assignment and inactive-user enforcement
- Server-only data access with RLS and direct browser database access revoked

## Runtime checks

- `GET /health` is the liveness probe.
- `GET /ready` probes PostgreSQL, core schema, R2, internal authentication, Supabase Auth and the application Owner account.
- `GET /api/v1/auth/status` returns safe authentication readiness diagnostics without credentials.

## Required Railway variables

- `INTERNAL_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `OWNER_EMAIL`
- `APP_BASE_URL`
- `R2_ACCOUNT_ID` or `R2_ENDPOINT`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

Never commit production credentials.

## Database deployment

For an existing installation, apply SQL files in filename order:

1. `supabase/schema.sql` is the preserved baseline.
2. `supabase/migrations/20260824030000_core_platform.sql` is the non-destructive production expansion.
3. `supabase/migrations/20260824040000_authorization_model.sql` adds teams, access policies and record grants, plus the integrity gaps the expansion left open.

The migrations retain existing case/document data, add operational entities and seed data, enable RLS on server-owned tables, and revoke direct `anon` and `authenticated` access. Translators, preparers, interpreters and representatives are form assignments—not case parties.

The authorization migration is additive only: the policy tables are created empty and every added column is nullable, so no existing user loses visibility. It also closes three integrity gaps: `case_events` and `documents` referenced `cases` with `ON DELETE CASCADE`, so deleting a case took its own history with it through the foreign key rather than through a blocked `DELETE`; documents gain soft-delete columns; and `filing_deadline` is a `date`, not a `timestamptz` — a deadline is a wall-clock day in a filing jurisdiction, and a timestamp renders as the previous day west of the server. The same rule applies to money: `numeric(12,2)` or integer minor units, never `float`/`real`.

## Local verification

```bash
node --check src/server.js
node --check src/auth.js
node --check src/platform.js
node --check src/intake-definitions.js
node --check src/access.js
npm test          # unit + API integration, no network or live backend
npm run test:e2e  # Playwright, drives the real server against a stub backend
```

## Security baseline

- Server-only Supabase service-role and R2 credentials
- Secure session cookies and same-origin write protection
- Backend RBAC on every protected route
- Private R2 objects and short-lived signed URLs
- MIME, size, case ownership and post-upload object verification
- Request size limits, input validation and output escaping
- HSTS, CSP, frame, referrer and MIME hardening headers
- Append-only operational audit events
- Deny-by-default route authorization: an unmapped `/api` path is refused
- CSRF gate that fails closed and pins the expected origin to `APP_BASE_URL`
- Per-identity login throttling
- Upstream database and storage error payloads never returned to clients
- No secrets or customer documents in Git

### Known residual risks

- `script-src` still allows `'unsafe-inline'`. The workspace is a single inline script with inline handlers on its static shell; removing the directive means extracting them behind a nonce. Interpolated values are escaped, so this is defence in depth rather than a known-exploitable hole.
- Login throttling is per process. Behind more than one instance the effective limit multiplies; a shared store is needed to scale it horizontally.
- Broad staff access remains the default, by design. It is now the Owner's decision rather than a hard-coded property, but an untouched deployment still has every staff member seeing every case.
- Listings apply the row filter after the query limit, so a narrowed principal paging a very large table may see fewer than `limit` rows per page.
