import { expect, test } from "@playwright/test";
import { accessToken, db, intakeBody, passedInterviewFixture, STAFF, submitIntake, uniqueIp } from "./helpers";

test("a historical pass cannot route a client to payment after a newer failed interview", async ({ request }) => {
  const intake = await submitIntake(request, intakeBody(`TEST Latest Interview Guard ${Date.now()}`));
  expect(intake.res.status(), JSON.stringify(intake.json)).toBe(201);
  const [client] = await db()`select id from clients where ref=${intake.json.ref}`;
  await passedInterviewFixture(request, String(client.id));
  const [actor] = await db()`select id from staff where auth_user_id=${STAFF.admin}`;
  const [appointment] = await db()`insert into appointments(client_id,appointment_type,appointment_kind,scheduled_at,ends_at,resource_key,created_by_staff,status)
    values(${client.id},'Employment interview','employment_interview',now()-interval '1 day',now()-interval '1 day'+interval '30 minutes','office',${actor.id},'attended') returning id`;
  await db()`insert into appointment_outcomes(appointment_id,client_id,decision,recorded_by,recorded_at)
    values(${appointment.id},${client.id},'fail',${actor.id},now()+interval '1 second')`;
  const response = await request.post("/api/staff/operations", {
    headers: { cookie: `cg_at=${await accessToken("admin")}`, "x-forwarded-for": uniqueIp() },
    data: { operation: "move_stage", client_id: client.id, stage: "payment_required" },
  });
  expect(response.status(), await response.text()).toBe(409);
  const [after] = await db()`select current_status from clients where id=${client.id}`;
  expect(after.current_status).toBe("pre_hire_completed");
});
