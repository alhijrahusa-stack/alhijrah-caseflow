import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { db, intakeBody, RUN, selectChoice, signIn, submitIntake } from "./helpers";

/**
 * Field operations added for the client page: a large phone photo is resized and
 * re-encoded in the browser before upload, and a manager can move a new file past
 * its prerequisites with no mandatory note.
 */

async function newClient(request: Parameters<typeof submitIntake>[0], label: string) {
  const intake = await submitIntake(request, intakeBody(`TEST Field ${label} ${RUN}`));
  expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
  const [client] = await db()`select id from clients where ref = ${intake.json.ref}`;
  return String(client.id);
}

/** A 4000×3000 photo-like PNG: noisy enough that PNG compression cannot hide its size. */
async function phonePhoto() {
  const width = 4000, height = 3000;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i += 3) {
    const x = (i / 3) % width, y = Math.floor(i / 3 / width);
    const noise = (x * 7919 + y * 104729) % 37;
    raw[i] = (x >> 4) + noise; raw[i + 1] = (y >> 4) + noise; raw[i + 2] = ((x + y) >> 5) + noise;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}

test("a large document photo is resized and stored as WebP within the upload limit", async ({ page, context, request, baseURL }) => {
  test.setTimeout(90_000);
  const clientId = await newClient(request, "Upload");
  const photo = await phonePhoto();
  expect(photo.byteLength).toBeGreaterThan(4 * 1024 * 1024);
  await signIn(context, baseURL!, "admin");
  await page.goto(`/staff/client/${clientId}`);
  await page.getByTestId("quick-actions").getByRole("button", { name: "Add Document" }).click();
  const form = page.getByTestId("form-document");
  await form.getByLabel("Document file").setInputFiles({ name: "IMG_4000.png", mimeType: "image/png", buffer: photo });
  await expect(form.getByTestId("upload-optimized")).toContainText("WebP");
  await selectChoice(form.getByLabel("Type", { exact: true }), "photo_id");
  await form.getByRole("button", { name: "Upload" }).click();
  await expect.poll(async () => (await db()`select mime_type, size_bytes, file_name from documents where client_id = ${clientId}`)[0], { timeout: 20_000 })
    .toMatchObject({ mime_type: "image/webp", file_name: "IMG_4000.webp" });
  const [doc] = await db()`select size_bytes from documents where client_id = ${clientId}`;
  expect(Number(doc.size_bytes)).toBeLessThan(photo.byteLength);
  expect(Number(doc.size_bytes)).toBeLessThanOrEqual(4 * 1024 * 1024);
});

test("a manager moves a new file to Job Ready directly with an optional note", async ({ page, context, request, baseURL }) => {
  const clientId = await newClient(request, "Skip");
  await signIn(context, baseURL!, "admin");
  await page.goto(`/staff/client/${clientId}`);
  const control = page.locator(".cg-workflow-control").first();
  await selectChoice(control.getByRole("combobox", { name: "Workflow destination" }), "job_ready");
  await control.getByRole("button", { name: "Move now ↗" }).click();
  await expect(control.getByRole("status")).toContainText("Moved to Job Ready");
  await expect.poll(async () => (await db()`select current_status, pipeline_stage from clients where id = ${clientId}`)[0])
    .toMatchObject({ current_status: "shift_selected", pipeline_stage: "amazon_account_waiting_job" });
  const [log] = await db()`select new_value from activity_log where client_id = ${clientId} and action = 'status_overridden'`;
  expect(log.new_value).toMatchObject({ reason: "Direct workflow move", skipped_prerequisites: true });
});

test("moving to Appointments requires no booking and keeps the file visible for later booking", async ({ page, context, request, baseURL }) => {
  const clientId = await newClient(request, "Interview");
  await signIn(context, baseURL!, "admin");
  await page.goto(`/staff/client/${clientId}`);
  const control = page.locator(".cg-workflow-control").first();
  await selectChoice(control.getByRole("combobox", { name: "Workflow destination" }), "appointments");
  await control.getByRole("button", { name: "Move now ↗" }).click();
  await expect(control.getByRole("status")).toContainText("Moved to Appointments");
  expect(await db()`select id from appointments where client_id=${clientId}`).toHaveLength(0);
  const [client] = await db()`select ref from clients where id=${clientId}`;
  await page.goto(`/staff/appointments?q=${encodeURIComponent(client.ref)}`);
  await expect(page.getByRole("region", { name: "Workflow files awaiting booking" }).getByText(client.ref, { exact: false })).toBeVisible();
});
