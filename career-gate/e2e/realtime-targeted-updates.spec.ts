import { expect, test, type APIRequestContext } from "@playwright/test";
import { accessToken, db, intakeBody, signIn, STAFF, submitIntake, uniqueIp } from "./helpers";

/**
 * Regression cover for the targeted update path.
 *
 * The normal update path must be entity-scoped: a staff mutation refetches
 * only the payloads the affected resources need, and must not fall back to a
 * full route refresh. `router.refresh()` survives only as recovery.
 */

const CLIENT_RESOURCE = "/api/staff/client-resource";

async function getStaff(request: APIRequestContext, role: keyof typeof STAFF, path: string) {
  const res = await request.get(path, { headers: { cookie: `cg_at=${await accessToken(role)}`, "x-forwarded-for": uniqueIp() } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}

test.describe.serial("realtime targeted updates", () => {
  let clientId = "";

  test.beforeAll(async ({ request }) => {
    const intake = await submitIntake(request, intakeBody(`TEST Targeted Update ${Date.now()}`));
    expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
    const [client] = await db()`select id from clients where ref=${intake.json.ref}`;
    clientId = client.id as string;
  });

  test("scoped read returns only the requested payloads", async ({ request }) => {
    const one = await getStaff(request, "admin", `${CLIENT_RESOURCE}?client_id=${clientId}&payloads=tasks`);
    expect(one.status, JSON.stringify(one.json)).toBe(200);
    expect(Object.keys(one.json.payloads)).toEqual(["tasks"]);

    const many = await getStaff(request, "admin", `${CLIENT_RESOURCE}?client_id=${clientId}&payloads=notes,activity`);
    expect(many.status).toBe(200);
    expect(Object.keys(many.json.payloads).sort()).toEqual(["activity", "notes"]);
  });

  test("scoped read answers the derived payloads", async ({ request }) => {
    const res = await getStaff(request, "admin", `${CLIENT_RESOURCE}?client_id=${clientId}&payloads=nextAction,account,requirements`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const keys = Object.keys(res.json.payloads);
    for (const key of ["nextAction", "account", "requirements", "readiness"]) expect(keys).toContain(key);
  });

  test("scoped read rejects bad input and unknown payloads", async ({ request }) => {
    expect((await getStaff(request, "admin", `${CLIENT_RESOURCE}?client_id=nope&payloads=tasks`)).status).toBe(400);
    expect((await getStaff(request, "admin", `${CLIENT_RESOURCE}?client_id=${clientId}`)).status).toBe(400);
    expect((await getStaff(request, "admin", `${CLIENT_RESOURCE}?client_id=${clientId}&payloads=pg_shadow`)).status).toBe(400);
  });

  test("scoped read keeps authorization on the server", async ({ request }) => {
    // The client is unassigned, so a plain staff member must not read it
    // through the targeted path either.
    const denied = await getStaff(request, "staff", `${CLIENT_RESOURCE}?client_id=${clientId}&payloads=client`);
    expect([403, 404]).toContain(denied.status);
  });

  test("a staff mutation updates the surface without a route refresh", async ({ context, page, baseURL }) => {
    await signIn(context, baseURL!, "admin");

    const scoped: string[] = [];
    const routeRefreshes: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes(CLIENT_RESOURCE)) scoped.push(url);
      // A `router.refresh()` re-requests the page itself as an RSC payload.
      else if (url.includes(`/staff/client/${clientId}`) && url.includes("_rsc=")) routeRefreshes.push(url);
    });

    await page.goto(`/staff/client/${clientId}?action=note`);
    await expect(page.getByTestId("form-note")).toBeVisible();

    const note = `TEST targeted note ${Date.now()}`;
    await page.fill("#note_text", note);
    scoped.length = 0;
    routeRefreshes.length = 0;
    await page.getByTestId("form-note").getByRole("button", { name: "Add note", exact: true }).click();

    // The refetch is the update path: it must happen, and the route must not.
    await expect.poll(() => scoped.length, { timeout: 10_000 }).toBeGreaterThan(0);

    const asked = new URL(scoped[0]).searchParams;
    expect(asked.get("client_id")).toBe(clientId);
    const payloads = (asked.get("payloads") ?? "").split(",").sort();
    expect(payloads).toEqual(["activity", "notes"]);

    expect(routeRefreshes, "the normal update path must not refresh the route").toEqual([]);
    // The fallback never ran, so no recovery reason was recorded.
    await expect(page.getByTestId("realtime-state")).toHaveAttribute("data-recovery", "");

    // The patched data really rendered: the note is in the client file now.
    await page.getByRole("button", { name: /Notes \/ Tasks \/ Contacts/ }).click();
    await expect(page.getByTestId("note-row").first()).toContainText(note);
    expect(routeRefreshes).toEqual([]);
  });

  test("a mutation on one client does not refetch another client", async ({ context, page, baseURL, request }) => {
    const other = await submitIntake(request, intakeBody(`TEST Untouched Client ${Date.now()}`));
    expect(other.res.status(), JSON.stringify(other.json)).toBe(201);
    const [row] = await db()`select id from clients where ref=${other.json.ref}`;
    const otherId = String(row.id);

    await signIn(context, baseURL!, "admin");
    const scoped: string[] = [];
    page.on("request", (req) => { if (req.url().includes(CLIENT_RESOURCE)) scoped.push(req.url()); });

    await page.goto(`/staff/client/${otherId}?action=note`);
    await expect(page.getByTestId("form-note")).toBeVisible();
    scoped.length = 0;

    // A note added to the first client, from outside this page.
    const res = await request.post("/api/staff/action", {
      data: { action: "add_note", client_id: clientId, note: `TEST cross client ${Date.now()}` },
      headers: { cookie: `cg_at=${await accessToken("admin")}`, "x-forwarded-for": uniqueIp() },
    });
    expect(res.status()).toBe(200);

    await page.waitForTimeout(1500);
    for (const url of scoped) {
      expect(new URL(url).searchParams.get("client_id"), "a change to one client must never refetch another").toBe(otherId);
    }
  });
});
