import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, signIn } from "./helpers";

test("mobile Smart Import queues server-side Gemini even after on-device OCR preview", async ({ page, baseURL }) => {
  await signIn(page.context(), baseURL!, "admin");
  const unique = randomUUID().slice(0, 8);
  const form = {
    notes: `Full Name: TEST Gemini Intake ${unique}\nPhone: 313-555-0188`,
    // Legacy clients may still send this flag; it must never disable actual Gemini.
    local_ocr_reviewed: "1",
    files: { name: "gemini-source.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]) },
  };
  const response = await page.request.post("/api/staff/smart-client-import/mobile", {
    multipart: form,
    headers: { "idempotency-key": randomUUID() },
  });
  expect(response.status(), await response.text()).toBe(202);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.enrichment_url).toBe(`/api/staff/smart-client-import/${body.case_id}/retry`);
  expect(body.verification_result.ai_state).toBe("PENDING");
  const [stored] = await db()`select count(*)::int as n from client_import_documents where import_case_id=${body.case_id}`;
  expect(stored.n).toBe(1);
});
