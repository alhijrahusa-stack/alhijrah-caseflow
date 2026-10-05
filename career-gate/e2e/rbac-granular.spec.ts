import { expect, test, type APIRequestContext } from "@playwright/test";
import { accessToken, db, intakeBody, PNG, STAFF, submitIntake, uniqueIp } from "./helpers";

type TestRole = keyof typeof STAFF;

async function permissionUpdate(
  request: APIRequestContext,
  role: TestRole | null,
  staffId: string,
  permissionMode: "full" | "custom",
  permissions: string[],
) {
  const headers: Record<string, string> = { "x-forwarded-for": uniqueIp() };
  if (role) headers.cookie = `cg_at=${await accessToken(role)}`;
  const response = await request.post("/api/staff/permissions", {
    headers,
    data: { staff_id: staffId, permission_mode: permissionMode, permissions },
  });
  return { status: response.status(), body: await response.json() };
}

test.describe.serial("B3 granular RBAC", () => {
  let adminId = "";
  let managerId = "";
  let staffId = "";

  test.beforeAll(async () => {
    const rows = await db()`select id, auth_user_id from staff where auth_user_id in (${STAFF.admin}, ${STAFF.manager}, ${STAFF.staff})`;
    adminId = String(rows.find((row) => row.auth_user_id === STAFF.admin)?.id ?? "");
    managerId = String(rows.find((row) => row.auth_user_id === STAFF.manager)?.id ?? "");
    staffId = String(rows.find((row) => row.auth_user_id === STAFF.staff)?.id ?? "");
    expect(adminId).toBeTruthy();
    expect(managerId).toBeTruthy();
    expect(staffId).toBeTruthy();
  });

  test.afterAll(async () => {
    if (adminId) await db()`update staff set permission_mode='full', permissions='{}'::text[] where id in (${adminId}, ${managerId}, ${staffId})`;
  });

  test("unauthenticated permission mutation is rejected", async ({ request }) => {
    const result = await permissionUpdate(request, null, staffId, "custom", ["add_note"]);
    expect(result.status).toBe(401);
  });

  test("staff cannot grant permissions, change own mode, or self-elevate role", async ({ request }) => {
    const ownMode = await permissionUpdate(request, "staff", staffId, "custom", ["add_note"]);
    expect(ownMode.status).toBe(403);

    const grant = await permissionUpdate(request, "staff", managerId, "full", []);
    expect(grant.status).toBe(403);

    const elevate = await request.post("/api/staff/action", {
      headers: { cookie: `cg_at=${await accessToken("staff")}`, "x-forwarded-for": uniqueIp() },
      data: { action: "update_staff_role", staff_id: staffId, role: "manager" },
    });
    expect(elevate.status()).toBe(403);

    const [unchanged] = await db()`select role, permission_mode from staff where id=${staffId}`;
    expect(unchanged.role).toBe("staff");
    expect(unchanged.permission_mode).toBe("full");
  });

  test("admin and manager can assign custom access; admin can restore full access", async ({ request }) => {
    const byAdmin = await permissionUpdate(request, "admin", staffId, "custom", ["add_note", "update_task"]);
    expect(byAdmin.status, JSON.stringify(byAdmin.body)).toBe(200);

    const byManager = await permissionUpdate(request, "manager", staffId, "custom", ["update_client"]);
    expect(byManager.status, JSON.stringify(byManager.body)).toBe(200);

    const [custom] = await db()`select permission_mode, permissions from staff where id=${staffId}`;
    expect(custom.permission_mode).toBe("custom");
    expect(custom.permissions).toEqual(["update_client"]);

    const full = await permissionUpdate(request, "admin", staffId, "full", []);
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    const [restored] = await db()`select permission_mode, permissions from staff where id=${staffId}`;
    expect(restored.permission_mode).toBe("full");
    expect(restored.permissions).toEqual([]);
  });

  test("unknown permission key is rejected", async ({ request }) => {
    const result = await permissionUpdate(request, "admin", staffId, "custom", ["invented_permission"]);
    expect(result.status).toBe(400);
    const [row] = await db()`select permission_mode from staff where id=${staffId}`;
    expect(row.permission_mode).toBe("full");
  });

  test("permission updates create before/after audit evidence", async ({ request }) => {
    const update = await permissionUpdate(request, "admin", staffId, "custom", ["add_note"]);
    expect(update.status, JSON.stringify(update.body)).toBe(200);

    const [event] = await db()`
      select staff_id, detail, created_at
      from security_events
      where event='staff_permissions_updated'
        and detail->>'target_staff_id'=${staffId}
      order by created_at desc
      limit 1`;
    expect(String(event.staff_id)).toBe(adminId);
    expect(event.detail.actor_staff_id).toBe(adminId);
    expect(event.detail.target_staff_id).toBe(staffId);
    expect(event.detail.previous_role).toBe("staff");
    expect(event.detail.new_role).toBe("staff");
    expect(event.detail.previous_permission_mode).toBe("full");
    expect(event.detail.new_permission_mode).toBe("custom");
    expect(event.detail.previous_permissions).toEqual([]);
    expect(event.detail.new_permissions).toEqual(["add_note"]);
    expect(event.created_at).toBeTruthy();

    await permissionUpdate(request, "admin", staffId, "full", []);
  });

  test("manager document verification is denied after permission removal and succeeds when restored", async ({ request }) => {
    const intake = await submitIntake(request, intakeBody(`TEST B3 RBAC ${Date.now()}`));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    const upload = await request.post("/api/intake/documents", {
      multipart: {
        upload_token: intake.json.upload_token,
        doc_type: "work_authorization",
        file: { name: "b3-rbac.png", mimeType: "image/png", buffer: PNG },
      },
    });
    const uploadJson = await upload.json();
    expect(upload.status(), JSON.stringify(uploadJson)).toBe(201);
    await expect.poll(async () => {
      const [row] = await db()`select status from documents where id=${uploadJson.id}`;
      return row?.status;
    }, { timeout: 15_000 }).toBe("needs_review");

    const remove = await permissionUpdate(request, "admin", managerId, "custom", []);
    expect(remove.status, JSON.stringify(remove.body)).toBe(200);

    const denied = await request.post("/api/staff/action", {
      headers: { cookie: `cg_at=${await accessToken("manager")}`, "x-forwarded-for": uniqueIp() },
      data: { action: "verify_document", document_id: uploadJson.id, review_note: "B3 denied check" },
    });
    expect(denied.status()).toBe(403);
    const [stillReview] = await db()`select status from documents where id=${uploadJson.id}`;
    expect(stillReview.status).toBe("needs_review");

    const restorePermission = await permissionUpdate(request, "admin", managerId, "custom", ["verify_document"]);
    expect(restorePermission.status, JSON.stringify(restorePermission.body)).toBe(200);

    const allowed = await request.post("/api/staff/action", {
      headers: { cookie: `cg_at=${await accessToken("manager")}`, "x-forwarded-for": uniqueIp() },
      data: { action: "verify_document", document_id: uploadJson.id, review_note: "B3 allowed check" },
    });
    expect(allowed.status()).toBe(200);
    const [verified] = await db()`select status, reviewed_by from documents where id=${uploadJson.id}`;
    expect(verified.status).toBe("verified");
    expect(String(verified.reviewed_by)).toBe(managerId);

    await permissionUpdate(request, "admin", managerId, "full", []);
  });

  test("role ceiling remains stronger than full granular mode", async ({ request }) => {
    await permissionUpdate(request, "admin", staffId, "full", []);
    const response = await request.post("/api/staff/action", {
      headers: { cookie: `cg_at=${await accessToken("staff")}`, "x-forwarded-for": uniqueIp() },
      data: { action: "run_audit_scan", client_id: null },
    });
    expect(response.status()).toBe(403);
  });
});
