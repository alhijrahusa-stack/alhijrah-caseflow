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

The migration retains existing case/document data, adds operational entities and seed data, enables RLS on server-owned tables, and revokes direct `anon` and `authenticated` access. Translators, preparers, interpreters and representatives are form assignments—not case parties.

## Local verification

```bash
node --check src/server.js
node --check src/auth.js
node --check src/platform.js
node --check src/intake-definitions.js
node --test
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
- No secrets or customer documents in Git
