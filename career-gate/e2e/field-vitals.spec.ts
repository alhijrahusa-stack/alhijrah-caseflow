import { expect, test } from "@playwright/test";
import { accessToken } from "./helpers";

/** Field Web Vitals beacon: signed-in staff only, validated, logged, nothing stored. */

const report = { name: "INP", value: 184, rating: "good", route: "/staff/client/02caec63-e239-40bf-8d3a-ccbdfa374a4a", screen: "phone", navigation: "navigate" };

test("a signed-in staff page can report a vital", async ({ request }) => {
  const res = await request.post("/api/staff/vitals", { headers: { cookie: `cg_at=${await accessToken("staff")}` }, data: report });
  expect(res.status()).toBe(204);
});

test("a malformed or oversized report is refused", async ({ request }) => {
  const cookie = `cg_at=${await accessToken("staff")}`;
  for (const data of [{ ...report, name: "FID" }, { ...report, value: -5 }, { ...report, route: "/apply" }]) {
    expect((await request.post("/api/staff/vitals", { headers: { cookie }, data })).status()).toBe(400);
  }
  const big = await request.post("/api/staff/vitals", { headers: { cookie, "content-type": "application/json" }, data: JSON.stringify({ ...report, pad: "x".repeat(4096) }) });
  expect(big.status()).toBe(413);
});

test("an anonymous report is refused", async ({ request }) => {
  const res = await request.post("/api/staff/vitals", { headers: { cookie: "" }, data: report });
  expect(res.status()).toBe(401);
});
