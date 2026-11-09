# BUILD SPEC — CASEFLOW TFWP Desk (new, isolated module)

## 0. Mission

Build a NEW production module, **CASEFLOW TFWP Desk**, for ALHIJRAH SERVICES LLC.
It manages Canadian TFWP/LMIA job-file cases. It has two apps:

- **Client portal** (`/portal`): the client logs in, submits an intake, uploads documents, and sees status and missing items.
- **Staff desk** (`/desk`): the office staff and managers do intake, editing, review, follow-up, compliance and performance.

**This is a new system. Do not touch, modify, refactor, migrate, rename or delete anything in any existing system.**

## 1. Isolation rules (non-negotiable)

1. All new code lives in `services/tfwp-desk/`, with its own `package.json`, its own tests and its own README.
2. Deploy it as a **separate Railway service**, with its own domain or subdomain. Do not mount routes into existing services.
3. Database:
   - Create objects only in a new Postgres schema `tfwp`.
   - Migrations live only in `services/tfwp-desk/supabase/migrations/`.
   - Never `ALTER`, `DROP`, `GRANT` or `REVOKE` on any object outside `tfwp`.
   - Never add triggers, hooks or policies to existing tables or to `auth.*`.
4. Supabase Auth is project-wide, so client and staff accounts would share `auth.users` with existing systems.
   - **Default: use a separate Supabase project for TFWP Desk.**
   - Use the existing project only if the owner approves this in writing in Phase 0.
5. Storage:
   - Use a new private R2 bucket `tfwp-docs`, or a new prefix approved in Phase 0.
   - Never read or write existing buckets or prefixes.
6. Environment variables:
   - Every new variable is prefixed `TFWP_`.
   - Never change or reuse existing variables.
7. Git:
   - Work on branch `feature/tfwp-desk`.
   - No force-push, and no edits to existing CI jobs. Add a new CI job for this service only.
8. Run the existing test suites before and after your work. They must stay unchanged and green.
9. If any task seems to require changing an existing file, STOP. Write the reason in `services/tfwp-desk/docs/INTEGRATION_REQUESTS.md` and wait for approval.

## 2. Stack (match existing CASEFLOW conventions)

- **Runtime:** Node.js 22, ES modules.
- **Front end:** plain HTML + `app.js` modules. No React, no Tailwind, no build step unless approved.
- **Data and auth:** Supabase (Postgres, Auth, Row Level Security).
- **Files:** Cloudflare R2, private only.
- **PDFs:** pdf-lib for generated PDFs (English CV and cover letter).
- **Text extraction:** pdfjs-dist and mammoth, server-side, for uploaded resumes.
- **Engines:** all decisions are deterministic code.
- **AI:** Anthropic API via `TFWP_ANTHROPIC_API_KEY`, with the model id from `TFWP_ANTHROPIC_MODEL`. AI is used only for:
  - (a) resume text → structured JSON;
  - (b) cover-letter wording polish that adds no facts.
- **Validation:** zod on every input. **Logging:** pino, with no PII in logs.

## 3. Reference prototype (functional spec)

The file `services/tfwp-desk/docs/prototype/alhijrah_tfwp_system.html` is the working prototype. The owner will place it there.

Port its logic as **pure functions** in `src/engine/`, with unit tests that reproduce the prototype's outputs:

| Prototype function | New module | Notes |
|---|---|---|
| `evaluate()` | `engine/evaluate.js` | Gates A–D. Returns findings with severity and gate, the verdict (green/amber/red), the computed years and the evidence coverage |
| `gaps()`, `gapMessage()` | `engine/gaps.js` | Levels: `cv`, `proof`, `boost`. Client-facing message in Arabic |
| `matchNOC()` | `engine/noc.js` | Replace the starter list with an import of the official **NOC 2021 V1.0** CSVs (Statistics Canada). Store `noc_version` on every match |
| `buildCV()`, `cvChecks()`, `canSpell()` | `engine/cv.js` | Canadian format: reverse chronological, no photo, DOB, marital status, passport number or NOC codes. Canadian spelling. Download is blocked if any check fails |
| `buildLetter()`, `matchTask()` | `engine/letter.js` | A posting task with no matching client duty goes into the "ready to learn" sentence, never claimed as experience |
| `STATUSES`, `NEXT`, `act()` | `engine/workflow.js` | State machine, enforced server-side |
| `EXTRACT_PROMPT` | `engine/extract.js` | Use the exact prompt. Extracted duties are stored as `source='stated'` until a document proves them |

Use the prototype's **Demo Client** fixture (`loadDemo()`) as the regression fixture. It must reproduce exactly:
- the overlap finding;
- the name-mismatch finding;
- the relative-signer finding;
- the amber verdict.

## 4. Data model (schema `tfwp`)

| Table | Key fields |
|---|---|
| `profiles` | `user_id` (FK auth.users), `role` enum(`client`,`intake`,`editor`,`reviewer`,`compliance`,`partner`,`manager`), `dept`, `active`, `created_at` |
| `clients` | `id`, `user_id` nullable, `full_name`, `email`, `phone`, `nationality`, `residence_country`, `residence_city`, `passport_last4`, `passport_expiry`, `passport_number_enc` (pgcrypto, key from `TFWP_PII_KEY`) |
| `consents` | `client_id`, `text_version`, `accepted_at`, `ip`, `user_agent` |
| `cases` | `id`, `file_no` (unique, `AH-YY-XXXXX`), `client_id`, `status` enum, `verdict`, `assignee`, `drafted_by`, `reviewed_by`, `approved_at`, `approved_noc` text[], `returns` int, `intake` jsonb (sectors, family, years_range, risk, docs), `created_at`, `updated_at` |
| `jobs` | `case_id`, `employer`, `title`, `city`, `country`, `start_month`, `end_month`, `present`, `full_time`, `name_match`, `relative_signer`, `in_cv` |
| `duties` | `job_id`, `text_en`, `source` enum(`document`,`stated`), `evidence_document_id` |
| `documents` | `case_id`, `type`, `r2_key`, `sha256`, `mime`, `size`, `uploaded_by`, `uploaded_at` |
| `document_access_log` | `document_id`, `actor`, `action` (`signed_get`/`signed_put`), `at`, `ip` |
| `evaluations` | `case_id`, `snapshot` jsonb, `engine_version`, `at` |
| `postings` | `case_id`, `job_bank_id`, `employer`, `title`, `apply_method`, `deadline`, `state`, `follow_up`, `applied_at` |
| `notes` | `case_id`, `author`, `body`, `at` (staff only) |
| `incidents` | `type` enum(`fee`,`defect`,`privacy`,`other`), `case_id` nullable, `body`, `reported_by`, `at` |
| `audit_log` | `actor`, `action`, `entity`, `entity_id`, `before` jsonb, `after` jsonb, `ip`, `at`. **Append-only** |
| `noc_units` | imported NOC 2021 rows: code, title, TEER, lead statement, main duties, example titles |
| `employers` | imported ESDC Positive LMIA Employers List: name, province, city, NOC, positions, quarter |

## 5. Authentication

- **Clients:** email one-time code (Supabase OTP). WhatsApp OTP is out of scope until the owner approves a provider.
- **Staff:**
  - Invite-only: a manager creates staff accounts. No staff self-signup.
  - Email and password, plus **mandatory TOTP MFA**.
- **Sessions:** the server verifies Supabase JWTs. Use httpOnly, Secure, SameSite=Lax cookies, plus a CSRF token on all state-changing requests.

## 6. Row Level Security (enforced in the database, tested)

1. **Client:**
   - Reads only their own `clients`, `cases`, `jobs`, `duties`, `documents` and `postings` rows.
   - Inserts documents only into their own case.
   - Edits intake data only while `status in ('triage','docs_pending')`.
   - Never reads `notes`, `evaluations`, `audit_log`, `incidents` or other clients' data.
2. **intake:** cases in `triage` and `docs_pending`.
3. **editor:** cases assigned to them in `drafting`.
4. **reviewer:** cases in `review` where `drafted_by <> auth.uid()`.
5. **partner:** cases in `referred` and `permit`.
6. **compliance:** read-only on everything, plus `incidents`.
7. **manager:** all.
8. **Maker-checker in the database:** a trigger rejects `review → approved` when `reviewed_by = drafted_by`.
9. **audit_log:**
   - Rows are written only by triggers on every table above.
   - No `UPDATE` or `DELETE` grant to anyone.
10. **SQL tests (pgTAP or plain SQL assertions)** must prove:
    - client A cannot read client B;
    - an editor cannot approve their own case;
    - a reviewer cannot see `drafting` cases;
    - audit rows cannot be changed.

## 7. Storage

- R2 is private. There are no public URLs, ever.
- Uploads go through server-signed PUT URLs (5 minutes). Downloads go through signed GET URLs (5 minutes).
- Allowed types: PDF, JPG, PNG, DOCX, up to 10 MB.
- Compute and store SHA-256 for every file.
- Every signed URL issued is written to `document_access_log`.

## 8. API (`/api/*` inside this service)

- **Intake:**
  - `POST /intake/draft` and `POST /intake/submit`.
  - Required at submit: name, phone, email and consent only. Everything else is optional.
- **Cases:**
  - `GET /cases` and `GET /cases/:id`, filtered by role.
  - `POST /cases/:id/transition {action, note}` → validated by the state machine and by role.
- **NOC:** `POST /cases/:id/noc/approve` and `POST /cases/:id/noc/revoke`.
- **Resume extraction:**
  - `POST /cases/:id/cv/extract` → returns JSON for review. Merging happens only through `POST /cases/:id/cv/merge`.
  - The merge fills empty fields and appends new jobs only.
- **Gaps:** `GET /cases/:id/gaps`.
- **Generation:**
  - `POST /cases/:id/cv/pdf {variant: farm|food}` → runs `cvChecks`, and returns 422 if any check fails.
  - `POST /cases/:id/letter {posting}`, `POST /cases/:id/letter/polish` and `POST /cases/:id/letter/pdf`.
- **Other resources:** `postings`, `incidents`, `staff` (manager only), `audit` (compliance and manager).
- **Protections:**
  - Rate limits, especially on auth and AI endpoints.
  - Security headers, including a strict CSP.
  - Clear 4xx error bodies, and no stack traces in production.

## 9. Front end

- Port the prototype's design: RTL Arabic, the glass theme (royal blue with cyan and emerald accents and soft gold edges), cards instead of tables, chips for ready-made answers, a step wizard with draft autosave, a receipt card with the file number, and a case stepper with a "next action" button.
- `/portal` shows the client only their own data and plain Arabic status text.
- `/desk` contains: dashboard pipeline, intake, cases, review queue, follow-up, departments and staff, and performance and compliance.
- Every page works on a 390 px mobile screen. The file picker must work in normal mobile browsers.

## 10. Compliance content (keep exactly as intent)

- **Footer:** the office provides administrative and document-preparation services. Immigration advice and representation are provided only by a licensed representative (IRPA s.91). The app gives no eligibility advice.
- **Consent text:** versioned and stored in `consents`.
- **Fees:** no recruitment or placement fees may be charged to workers. Any fee request is logged as an incident.
- **No unverified claims** in the UI: no "PIPEDA compliant", no "guaranteed", no "verified".
- **Retention:** retention period setting, plus a delete-on-request job that removes R2 objects and rows and keeps an audit entry.
- **No automation of Job Bank, IRCC or ESDC.** Their terms forbid automated access. The system only tracks what staff and clients do manually.

## 11. Phases and acceptance

| Phase | Work | Acceptance |
|---|---|---|
| 0 | Read the repo. List existing services, schemas, tables, buckets, env vars and routes. Write `docs/ISOLATION_PLAN.md` and decide Supabase project / bucket. **No code.** | **STOP and wait for owner approval.** |
| 1 | Schema `tfwp`, enums, RLS, triggers, audit, SQL tests. Client OTP and staff invite + MFA. | All RLS tests pass. Existing test suites unchanged and green. |
| 2 | Port the engines with unit tests. | Demo Client fixture reproduces the prototype's findings, verdict, NOC ranking, CV text and letter text. |
| 3 | API + R2 signed URLs + access log. | Integration tests for every endpoint and every role. |
| 4 | `/portal` and `/desk` UI. | Manual test script passes on desktop and a 390 px mobile screen. |
| 5 | AI extraction, CV and letter PDFs. | `cvChecks` blocks bad CVs. Extraction never invents facts on 5 sample resumes. |
| 6 | Railway service (staging, then production) and a runbook. | Smoke tests pass on staging. Owner approves before production. |

At the end of each phase: commit, run all tests, and write a short summary of what changed, what was tested and what is pending, in `docs/PROGRESS.md`.

## 12. Do not

- Modify any existing code, table, policy, function, trigger, bucket, environment variable, Railway service, domain or DNS record.
- Send real emails or messages to clients during development. Use test mode.
- Store full passport numbers in plain text, or log PII.
- Add external services beyond Supabase, R2 and the Anthropic API without approval.
- Mark any phase as complete without passing its acceptance tests.
