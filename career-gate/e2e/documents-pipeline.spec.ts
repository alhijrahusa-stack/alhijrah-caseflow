import { expect, test } from "@playwright/test";
import { db, intakeBody, PNG, RUN, signIn, submitIntake } from "./helpers";

test.describe.serial("document pipeline", () => {
  test("public upload persists, processes, survives deep link, and verifies in staff", async ({ request, browser, baseURL }) => {
    const intake = await submitIntake(request, intakeBody(`TEST Document Pipeline ${RUN}`));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    expect(typeof intake.json.upload_token).toBe("string");

    const [client] = await db()`select id from clients where ref = ${intake.json.ref}`;
    expect(client?.id).toBeTruthy();

    const upload = await request.post("/api/intake/documents", {
      multipart: {
        upload_token: intake.json.upload_token,
        doc_type: "work_authorization",
        file: {
          name: "public-work-authorization.png",
          mimeType: "image/png",
          buffer: PNG,
        },
      },
    });
    const uploadJson = await upload.json();
    expect(upload.status(), JSON.stringify(uploadJson)).toBe(201);
    expect(uploadJson.ok).toBe(true);
    expect(uploadJson.id).toMatch(/^[0-9a-f-]{36}$/i);

    await expect.poll(async () => {
      const [row] = await db()`select status from documents where id = ${uploadJson.id}`;
      return row?.status;
    }, { timeout: 15_000 }).toBe("needs_review");

    const [extraction] = await db()`
      select status
      from document_extractions
      where document_id = ${uploadJson.id}
      order by created_at desc
      limit 1
    `;
    expect(extraction?.status).toBe("not_configured");

    const context = await browser.newContext({ baseURL });
    await signIn(context, baseURL!, "admin");
    const page = await context.newPage();

    await page.goto(`/staff/client/${client.id}?tab=documents`);
    await expect(page).toHaveURL(new RegExp(`/staff/client/${client.id}\\?tab=documents$`));
    await expect(page.getByTestId("documents-tab-content")).toBeVisible();
    await expect(page.getByTestId("document-row")).toHaveCount(1);
    await expect(page.getByTestId("extraction-state")).toContainText("NOT_CONFIGURED");

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/staff/client/${client.id}\\?tab=documents$`));
    await expect(page.getByTestId("documents-tab-content")).toBeVisible();
    await expect(page.getByTestId("extraction-state")).toContainText("NOT_CONFIGURED");

    await page.getByTestId("document-row").getByRole("button", { name: "Verify" }).click();
    await expect(page.getByTestId("document-status")).toHaveText("Verified");

    const [verified] = await db()`
      select status, reviewed_by, reviewed_at, sha256
      from documents
      where id = ${uploadJson.id}
    `;
    expect(verified.status).toBe("verified");
    expect(verified.reviewed_by).toBeTruthy();
    expect(verified.reviewed_at).toBeTruthy();
    expect(verified.sha256).toMatch(/^[0-9a-f]{64}$/);

    await context.close();
  });
});
