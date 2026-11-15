# ALHIJRAH Canada Desk v2.2 — Production deploy runbook (09b955c)

Why this runbook exists: from the Claude cloud session, `wrangler deploy` fails at the static-assets upload
(`POST /workers/assets/upload -> 401`). The session's network proxy replaces every `Authorization` header sent to
api.cloudflare.com with the saved API token, including the short-lived upload JWT that this endpoint requires.
Run the steps below from a machine where wrangler sends the token itself (owner's computer or CI).

Artifacts (this folder):
- `canada-desk-deploy-09b955c.tar.gz` — built Worker (`dist/`), `drizzle/` migrations, `scripts/deploy-config.mjs`.
  Built from commit 09b955c; validated with `wrangler deploy --dry-run` against the real D1/R2 names.
- `canada-desk-09b955c.bundle` — full git history of the source (`git clone canada-desk-09b955c.bundle canada-desk`).

Requirements: Node 22+, a Cloudflare API token with Workers Scripts:Edit, D1:Edit, Workers R2 Storage:Edit
(account) and Workers Routes:Edit (zone careergate.us).

```bash
mkdir canada-desk && tar -xzf canada-desk-deploy-09b955c.tar.gz -C canada-desk && cd canada-desk
export CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=d0fe73337086a7eef5df3319756464cb
export CF_D1_DATABASE_ID=beda84dd-472a-4dec-beb7-e52c81c74732 CF_D1_DATABASE_NAME=alhijrah-canada-db \
       CF_R2_BUCKET=alhijrah-canada-docs CF_WORKER_NAME=alhijrah-canada-desk \
       OFFICE_ADMIN_EMAIL=Alhijrahusa@gmail.com SHADOW_ONLY=false CF_ENGINE_SHADOW_CRON=1 \
       CF_CUSTOM_DOMAIN=desk.careergate.us,canada.careergate.us
W="npx --yes wrangler@4.92.0"; C=dist/server/wrangler.deploy.json
node scripts/deploy-config.mjs

# 1. Rollback point + backup (record the bookmark printed here)
$W d1 time-travel info alhijrah-canada-db --config $C
$W d1 export alhijrah-canada-db --remote --output backup.sql --config $C && sha256sum backup.sql

# 2. Pending migrations must be exactly 0024..0031 — stop if 0000..0023 appear
$W d1 migrations list alhijrah-canada-db --remote --config $C

# 3. Apply, then deploy immediately (Durable Object migration v22-case-chat-room is applied by deploy)
$W d1 migrations apply alhijrah-canada-db --remote --config $C
$W deploy --config $C --message "v2.2 Gate 6 09b955c"

# 4. If step 3 deploy fails: return the database to the bookmark from step 1 (old code needs the old schema)
# $W d1 time-travel restore alhijrah-canada-db --bookmark=<bookmark from step 1> --config $C
```

Verification after deploy:
- `curl -s -o /dev/null -w '%{http_code}' https://desk.careergate.us/staff/login` → 200
- `curl -s -o /dev/null -w '%{http_code}' https://desk.careergate.us/api/office` → 401 without a session
- Sign in at `/staff/login` as Alhijrahusa@gmail.com; the office dashboard (`/api/office`) must load (200).
- `$W deployments list --config $C` shows the "v2.2 Gate 6 09b955c" message at 100%.

Do not run `wrangler secret put` for APP_SECRET: it already exists on the Worker and must not change.
