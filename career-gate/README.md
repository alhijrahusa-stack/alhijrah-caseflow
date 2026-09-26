# Career Gate

Job-application intake and case tracking for Michigan warehouse placements. Next.js (App Router) + Supabase.

- **Public** — `/apply` (7-step wizard: city → site → job → primary shift → backup shift → pay → personal) and `/status/[ref]` (lookup needs the reference **and** the last 4 phone digits).
- **Staff** — `/dashboard`, `/clients`, `/clients/[id]` (workflow, appointments, documents + OCR, payments, activity), `/appointments`, `/tasks`, `/reports`. Sign in at `/login`.

## Setup

```bash
cp .env.example .env.local   # fill in Supabase + WhatsApp values
npm install
npm run dev
```

Apply `supabase/migrations/001_initial_schema.sql` (`supabase db push` or the SQL editor). Staff access requires a row in `public.profiles` for the auth user:

```sql
insert into public.profiles (id, full_name, role) values ('<auth user id>', 'Name', 'admin');
```

## Security model

- Every table has RLS. Only active `profiles` rows (staff) can read or write; `anon` has no table access.
- `/api/intake` and the status lookup use the service role server-side and validate their own input (zod + catalog check + honeypot).
- `activity` and `workflow_events` are append-only (trigger). Payments are a ledger; only admins may void/refund.
- Documents live in the private `client-documents` bucket; downloads use 60-second signed URLs.

## Workflow

`lib/workflow/engine.ts` defines the stages and allowed transitions:

```
new → documents_pending → documents_verified → appointment_scheduled → application_submitted → hired | rejected
                                  (any open stage → withdrawn)
```

Guards: `documents_verified` needs ≥1 verified document; `appointment_scheduled` needs a scheduled appointment. Entering a stage creates follow-up tasks and, if the client consented, queues a WhatsApp notification. The stage update is conditional on the stage read, so concurrent transitions cannot both win.

## Notifications

Rows in `public.notifications` are drained by `supabase/functions/process-notifications` (Deno). `claim_notifications()` takes a 10-minute lease with `FOR UPDATE SKIP LOCKED`, so parallel runs never double-send and crashed runs are retried; failures back off exponentially up to 5 attempts. Deploy and schedule it:

```bash
supabase functions deploy process-notifications --no-verify-jwt
supabase secrets set WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_API_VERSION=...
```

Invoke with `Authorization: Bearer <service role key>` (e.g. pg_cron + pg_net every minute). Template names (`intake_received`, `documents_requested`, `appointment_confirmed`, `application_submitted`, `hired`) must exist as approved templates in the WhatsApp Business account. `lib/whatsapp/sender.ts` is the Node equivalent for direct server-side sends.

## Catalog data

`data/amazon-michigan.json` is **placeholder data**. Site codes, names, jobs, shifts and pay are samples. Replace them with verified postings before launch; the intake API rejects any selection not in this file.

## Checks

```bash
npm run typecheck
npm test
npm run build
```
