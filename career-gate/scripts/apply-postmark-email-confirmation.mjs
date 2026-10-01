import fs from 'node:fs';

function patch(path, from, to, expected = 1) {
  let text = fs.readFileSync(path, 'utf8');
  const count = text.split(from).length - 1;
  if (count !== expected) throw new Error(`${path}: expected ${expected} occurrence(s), found ${count}`);
  text = text.replace(from, to);
  fs.writeFileSync(path, text);
}

// Public intake sends selected locale with the same form state.
patch(
  'public/career-gate.html',
  "uid:state.uid,caseNumber:'',",
  "uid:state.uid,caseNumber:'',locale:state.locale,",
);

// Application route: locale, transactional outbox, and post-commit delivery.
patch(
  'app/api/application/route.ts',
  'import { logActivity, type Tx } from "@/lib/service";\nimport { NextResponse } from "next/server";',
  'import { logActivity, type Tx } from "@/lib/service";\nimport { buildAbsoluteTrackingUrl, processPendingConfirmationEmails, PUBLIC_INTAKE_CONFIRMATION_TEMPLATE } from "@/lib/email/postmark";\nimport { after, NextResponse } from "next/server";',
);
patch(
  'app/api/application/route.ts',
  '  uid: z.string().trim().min(8).max(200),\n  caseNumber:',
  '  uid: z.string().trim().min(8).max(200),\n  locale: z.enum(["ar", "en"]).default("ar"),\n  caseNumber:',
);
patch(
  'app/api/application/route.ts',
  "        preferred_language = 'ar',",
  '        preferred_language = ${d.locale},',
);
patch(
  'app/api/application/route.ts',
  "      'public_intake', ${fullName}, ${digits}, ${email}, ${dateOrNull(d.dob)}, 'ar',",
  "      'public_intake', ${fullName}, ${digits}, ${email}, ${dateOrNull(d.dob)}, ${d.locale},",
);
patch(
  'app/api/application/route.ts',
  '      const app = await insertApplication(tx, client.id, d);\n\n      await tx`',
  `      const app = await insertApplication(tx, client.id, d);\n      const relativeTrackingUrl = \`/career-gate.html?track=1&case=\${encodeURIComponent(app.case_number)}\`;\n      const submittedAt = new Date(app.created_at).toISOString();\n      const emailPayload = {\n        clientName: \`\${d.firstName} \${d.lastName}\`.trim(),\n        caseNumber: app.case_number,\n        submittedAt,\n        trackingUrl: buildAbsoluteTrackingUrl(relativeTrackingUrl),\n        service: d.serviceLabel || d.service,\n        email: d.email.trim().toLowerCase(),\n        phone: d.phone,\n        workType: d.workType,\n        shiftName: d.shiftName || d.shift || d.selectedShift,\n        shiftDays: d.shiftDays,\n        shiftHours: d.shiftHours,\n        expectedPay: d.expectedPay || d.totalPay,\n        branchName: d.branchName,\n        branchAddress: d.branchAddress,\n      };\n      await tx\`\n        insert into career_gate_email_outbox (application_id, template_key, recipient_email, locale, payload)\n        values (\${app.id}, \${PUBLIC_INTAKE_CONFIRMATION_TEMPLATE}, \${d.email.trim().toLowerCase()}, \${d.locale}, \${tx.json(emailPayload as never)})\n        on conflict (application_id, template_key) do nothing\n      \`;\n\n      await tx\``,
);
patch(
  'app/api/application/route.ts',
  '        trackingUrl: `/career-gate.html?track=1&case=${encodeURIComponent(app.case_number)}`,\n        submittedAt: new Date(app.created_at).toISOString(),',
  '        trackingUrl: relativeTrackingUrl,\n        submittedAt,',
);
patch(
  'app/api/application/route.ts',
  '      return { kind: "new" as const, status: 201, body };',
  '      return { kind: "new" as const, status: 201, body, applicationId: app.id };',
);
patch(
  'app/api/application/route.ts',
  '    const body = out.body;\n    const clientId = String(body.client_id ?? "");',
  `    const body = out.body;\n    let applicationId = out.kind === "new" ? out.applicationId : "";\n    if (!applicationId) {\n      const rows = await db\`select id from career_gate_applications where submission_uid = \${d.uid} limit 1\`;\n      applicationId = String(rows[0]?.id ?? "");\n    }\n    if (applicationId) {\n      after(async () => {\n        try {\n          await processPendingConfirmationEmails(1, applicationId);\n        } catch (error) {\n          console.error("Career Gate confirmation email delivery failed", error);\n        }\n      });\n    }\n    const clientId = String(body.client_id ?? "");`,
);

// Retry pending transactional emails from the existing maintenance cron.
patch(
  'app/api/cron/maintenance/route.ts',
  'import { runAudit } from "@/lib/audit";\nimport { sql } from "@/lib/db";',
  'import { runAudit } from "@/lib/audit";\nimport { sql } from "@/lib/db";\nimport { processPendingConfirmationEmails } from "@/lib/email/postmark";',
);
patch(
  'app/api/cron/maintenance/route.ts',
  '  const jobs = await processJobs(50);\n  const audit = await runAudit(null, traceId);',
  '  const jobs = await processJobs(50);\n  const confirmationEmails = await processPendingConfirmationEmails(20);\n  const audit = await runAudit(null, traceId);',
);
patch(
  'app/api/cron/maintenance/route.ts',
  '  return ok({ jobs: jobs.length, audit, cleanup }, 200, traceId);',
  '  return ok({ jobs: jobs.length, confirmation_emails: confirmationEmails, audit, cleanup }, 200, traceId);',
);

// Production URL may fall back to the already-configured app URL or canonical live URL; secrets remain mandatory.
patch(
  'lib/email/postmark.ts',
  'export function publicBaseUrl() {\n  return requiredEnv("CAREER_GATE_PUBLIC_URL").replace(/\\/+$/, "");\n}',
  'export function publicBaseUrl() {\n  const value = process.env.CAREER_GATE_PUBLIC_URL?.trim() || process.env.APP_BASE_URL?.trim() || "https://alhijrah-caseflow.vercel.app";\n  return value.replace(/\\/+$/, "");\n}',
);

// Document required provider settings without committing credentials.
patch(
  '.env.example',
  'RESEND_WEBHOOK_SECRET=\n',
  `RESEND_WEBHOOK_SECRET=\n\n# --- Email (Postmark transactional confirmation) -----------------------------\nPOSTMARK_SERVER_TOKEN=\nCAREER_GATE_FROM_EMAIL=\nCAREER_GATE_FROM_NAME=Career Gate\nCAREER_GATE_PUBLIC_URL=https://alhijrah-caseflow.vercel.app\nPOSTMARK_WEBHOOK_SECRET=\n`,
);

console.log('Postmark public-intake confirmation implementation applied.');
