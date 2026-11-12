# Integration Requests

Items that would touch something outside `services/tfwp-desk/`. Nothing here has been changed. Each waits for owner approval.

| # | Opened | Target (existing) | Why | Status |
|---|---|---|---|---|
| IR-1 | 2026-11-09 (Phase 0) | Existing Railway service for Alhijrah Caseflow (live setting, not a repo file) | `DEPLOY_STEPS.md` says it auto-deploys on every push to `main`. If it has no Watch Paths, merging TFWP files into `main` triggers a rebuild of that service. The image is unchanged (its `Dockerfile` copies only `src/`), but it is still a redeploy. Watch Paths on that service: **NOT VERIFIED**. | Owner to check; no change requested unless the owner wants to avoid the redeploy. |
| IR-2 | 2026-11-09 (Phase 0) | Root `.vercelignore` / root `vercel.json` (existing files) | Only relevant if a Vercel project builds from the repository root (the root `vercel.json` suggests one may exist; Career Gate uses Root Directory `career-gate`). In that case the new directory would be uploaded with the bundle (not served — all routes go to `api/index.js`). **NOT VERIFIED.** | No change requested. Raise again only if the owner confirms a root-level Vercel project and wants `services/` excluded. |
