import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { accessToken, db, PNG, uniqueIp } from "./helpers";

async function managerHeaders() {
  return {
    cookie: `cg_at=${await accessToken("manager")}`,
    "x-forwarded-for": uniqueIp(),
  };
}

test("Smart Client document reattach API links a synthetic file to the staged import", async ({ request }) => {
  const headers = await managerHeaders();
  const staged = await request.post("/api/staff/smart-client-import/mobile", {
    headers,
    multipart: {
      notes: "Full Name: Gap Twenty Two Test\nPhone: 3135550122\nEmail: gap22@test.invalid",
      idempotency_key: randomUUID(),
    },
  });
  expect(staged.status()).toBe(202);
  const stagedJson = await staged.json();
  expect(stagedJson.ok).toBe(true);
  const caseId = String(stagedJson.case_id);
  expect(caseId).toMatch(/^[0-9a-f-]{36}$/i);

  const reattached = await request.post(`/api/staff/smart-client-import/${caseId}/reattach`, {
    headers: await managerHeaders(),
    multipart: {
      files: {
        name: "gap22-proof.png",
        mimeType: "image/png",
        buffer: PNG,
      },
    },
  });
  expect(reattached.status()).toBe(201);
  const reattachedJson = await reattached.json();
  expect(reattachedJson.ok).toBe(true);
  expect(reattachedJson.case_id).toBe(caseId);
  expect(reattachedJson.document_count).toBe(1);
  expect(reattachedJson.documents).toHaveLength(1);
  expect(reattachedJson.documents[0].original_filename).toBe("gap22-proof.png");
  expect(reattachedJson.documents[0].mime_type).toBe("image/png");
  expect(reattachedJson.retry_url).toBe(`/api/staff/smart-client-import/${caseId}/retry`);

  const docs = await db()`
    select import_case_id,storage_reference,original_filename,mime_type,size_bytes,sha256,uploaded_by
    from client_import_documents
    where import_case_id=${caseId}
    order by created_at,id`;
  expect(docs).toHaveLength(1);
  expect(String(docs[0].import_case_id)).toBe(caseId);
  expect(docs[0].original_filename).toBe("gap22-proof.png");
  expect(docs[0].mime_type).toBe("image/png");
  expect(Number(docs[0].size_bytes)).toBe(PNG.length);
  expect(String(docs[0].storage_reference)).toContain(`smart-import/${caseId}/`);
  expect(String(docs[0].sha256)).toMatch(/^[0-9a-f]{64}$/);

  const [caseRow] = await db()`
    select verification_result
    from client_import_cases
    where id=${caseId}`;
  expect(Number(caseRow.verification_result?.document_count)).toBe(1);
  expect(caseRow.verification_result?.ai_state).toBe("PENDING");
});
