import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

afterAll(async () => {
  await db.end();
});

describe("B3 granular RBAC schema", () => {
  it("preserves existing access with full mode as the default", async () => {
    const [row] = await db`
      insert into staff (display_name, email, role)
      values ('B3 Default Test', 'b3-default@test.invalid', 'staff')
      returning permission_mode, permissions`;
    expect(row.permission_mode).toBe("full");
    expect(row.permissions).toEqual([]);
  });

  it("rejects invalid permission modes", async () => {
    await expect(db`
      insert into staff (display_name, email, role, permission_mode)
      values ('B3 Invalid Mode', 'b3-invalid-mode@test.invalid', 'staff', 'anything')
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects unknown permission keys at the database boundary", async () => {
    await expect(db`
      insert into staff (display_name, email, role, permission_mode, permissions)
      values ('B3 Invalid Permission', 'b3-invalid-permission@test.invalid', 'staff', 'custom', array['invented_permission']::text[])
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("accepts canonical custom permissions", async () => {
    const [row] = await db`
      insert into staff (display_name, email, role, permission_mode, permissions)
      values ('B3 Custom Test', 'b3-custom@test.invalid', 'staff', 'custom', array['add_note','update_task']::text[])
      returning permission_mode, permissions`;
    expect(row.permission_mode).toBe("custom");
    expect(row.permissions).toEqual(["add_note", "update_task"]);
  });
});
