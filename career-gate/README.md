# Career Gate

ALHIJRAH SERVICES LLC — recruitment-office system. Next.js App Router, TypeScript, Tailwind, Supabase Postgres + private Storage, deployed on Vercel.

Office: Alhijrahusa@gmail.com · 313-339-3566 · WhatsApp 313-919-4292

## Routes

| Route | Who | Purpose |
| --- | --- | --- |
| `/apply` | Public | Michigan → City → Site → Job → Primary → Backup → Pay → Personal → Documents → Review/Authorization/Signature |
| `/status/[ref]?t=<token>` | Public | Read-only status: reference, status, next step, appointment, start date, last updated |
| `/staff` | Office | Dashboard cards (live counts, each opens its records) |
| `/staff/new-client` | Office | Create a full client file (same model and CG reference as public applications) |
| `/staff/clients` | Office | Search (reference, name, phone, email) and filters (status, city, appointment date, follow-up due, handled by) |
| `/staff/client/[id]` | Office | Client File: profile, Amazon and employment history, preferences with pay snapshot, documents, appointments, notes, tasks, contacts, follow-ups, post-hire tracking, activity log, message preview |
| `/staff/client/[id]/edit` | Office | Edit profile, history, preferences, next step, assigned staff |
| `/staff/appointments`, `/staff/tasks`, `/staff/follow-ups` | Office | Cross-client work queues |
| `POST /api/intake` | Public | Validates payload, catalog relationships and consent; creates the client, history, preferences and signed authorization in one transaction; returns reference and status URL |
| `POST /api/intake/documents` | Public | Applicant uploads, authorized by the status token, for 2 hours after submission |
| `POST /api/staff/action` | Office | All office mutations, validated server-side, each in a transaction with an activity-log entry |
| `POST /api/staff/documents` | Office | Office uploads |
| `GET /api/documents/[id]` | Office | 10-minute signed URL; logs `document_access_log` and `document_opened` |

## Office access

There are no individual staff accounts. Each action records **Handled By** (Yusuf, Salah, Anas from `staff_directory`).

The `/staff` area and office APIs are closed behind one shared office key (`STAFF_ACCESS_KEY`), entered once per browser. This is not per-user authentication. It keeps client PII and ID documents off the open internet. Without the variable set in production, the office area stays closed.

## Job catalog

`data/job-catalog.json` is the only source for sites, jobs, shifts, schedules and pay. It currently lists **no sites**. Until real, verified entries are added:

- `/apply` shows that no openings are listed and still accepts the application, without preferences.
- Office staff cannot add preferences.

Format (only `active: true` entries are offered; missing facts stay `null` and are shown as not listed):

```json
{
  "state": "MI",
  "source": "where these facts came from",
  "sites": [
    {
      "city": "…", "site_code": "…", "site_name": "…", "address": "…", "active": true,
      "source": "…", "last_verified_at": "YYYY-MM-DD",
      "jobs": [
        {
          "job_id": "…", "job_title": "…", "employment_type": "…", "active": true,
          "shifts": [
            { "shift_code": "…", "days": "…", "start_time": "…", "end_time": "…", "pay": "…", "active": true,
              "source": "…", "last_verified_at": "YYYY-MM-DD" }
          ]
        }
      ]
    }
  ]
}
```

Pay is stored as a text snapshot on each preference at selection time, so later catalog edits do not change past selections. Changing the catalog requires a redeploy.

## Deploy

1. **Supabase**
   - Run `supabase/migrations/001_initial_schema.sql` in the SQL editor. It creates the tables, the `CG-YYYY-NNNNNN` reference counter, append-only triggers, seeds Yusuf/Salah/Anas, enables RLS with no policies (the Data API roles get nothing), and creates the private `documents` bucket.
   - Confirm under Storage that `documents` is **not public**.
2. **Vercel**
   - Import this repository.
   - Set **Root Directory** to `career-gate`.
   - Add the four variables from `.env.example` for Production:
     - `DATABASE_URL`: the transaction pooler string, port 6543.
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `STAFF_ACCESS_KEY`
   - Deploy.
3. **Smoke test the deployment** (creates two test clients):

   ```bash
   BASE_URL=https://<deployment> STAFF_ACCESS_KEY=<key> PW_CHROMIUM="" npx playwright test
   ```

## Checks

```bash
npm run typecheck
npm test           # unit tests
npm run test:e2e   # Postgres 16 + Storage stand-in + next start + Playwright; CATALOG=real uses the committed catalog
```

The e2e suite runs locally against real Postgres. Supabase Storage is replaced there by `e2e/storage-double.mjs`, which implements the four REST endpoints the app calls. The real Storage path is exercised only by the deployed smoke test.

## Data rules

- No Amazon passwords and no SSNs (full or partial) are collected.
- The signing time is the database clock. The browser's date is never used.
- The authorization text, its SHA-256, version, printed name, typed signature and consent are stored immutably.
- Notes, the activity log, the document access log and authorizations are append-only (enforced by triggers).
- Messages are never sent automatically. The Client File offers a preview, **Copy Message**, and links that open WhatsApp or email for staff to send. **Mark Contacted** records what was actually done.
