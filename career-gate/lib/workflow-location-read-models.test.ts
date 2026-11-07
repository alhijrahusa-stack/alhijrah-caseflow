import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSession, Tx } from "@/lib/auth";
import { CLIENT_STAGES } from "@/lib/client-lifecycle-filters";
import { workflowFilter } from "@/lib/workflow-filters";
import { appointmentList, appointmentPage, followupList, followupPage, taskList, taskPage } from "@/lib/queries";
import { activePipelineData } from "@/lib/operational-pipeline";

type Fragment = { text: string; values: unknown[] };
const state = vi.hoisted(() => ({ statements: [] as Fragment[], pipelineClients: [] as Record<string, unknown>[] }));

vi.mock("@/lib/auth", () => {
  const tag = (parts: TemplateStringsArray, ...values: unknown[]) => {
    const bound: unknown[] = [];
    const text = parts.reduce((text, part, index) => {
      if (!index) return part;
      const value = values[index - 1];
      if (value && typeof value === "object" && "text" in value && "values" in value) {
        const fragment = value as Fragment;
        bound.push(...fragment.values);
        return `${text}${fragment.text}${part}`;
      }
      bound.push(value);
      return `${text}?${part}`;
    }, "").replace(/\s+/g, " ").trim();
    const fragment = { text, values: bound };
    state.statements.push(fragment);
    const rows = text.startsWith("select count(*)") ? [{ total: 0 }]
      : text.startsWith("select key,position") ? [{ key: "payment_required", terminal: false }, { key: "post_interview_completion", terminal: false }]
      : text.startsWith("select c.id,c.ref,c.full_name,c.pipeline_stage") ? state.pipelineClients : [];
    return Object.assign(Promise.resolve(rows), fragment);
  };
  const tx = Object.assign(tag, { unsafe: (text: string) => ({ text, values: [] }) });
  return { withStaff: (_session: unknown, read: (tx: unknown) => unknown) => read(tx) };
});

const session: StaffSession = { authUserId: "auth-id", staff: { id: "staff-id", display_name: "Manager", email: null, role: "manager" } };

beforeEach(() => {
  state.statements.length = 0;
  state.pipelineClients.length = 0;
});

describe("exclusive workflow read membership", () => {
  it("binds every stage, including Urgent, to one canonical location", () => {
    const tx = ((parts: TemplateStringsArray, ...values: unknown[]) => ({ text: parts.join("?"), values })) as unknown as Tx;
    for (const { id } of CLIENT_STAGES) {
      expect(workflowFilter(tx, id)).toEqual({ text: "c.operational_location=?", values: [id] });
    }
  });

  it.each(["active", "upcoming", "next_2h", "today", "all"])("scopes %s appointment rows and their count to the appointment location", async (view) => {
    await appointmentPage(session, view);
    const statements = state.statements.filter(({ text }) => text.includes("from appointments a join clients c"));
    expect(statements).toHaveLength(2);
    for (const { text } of statements) {
      expect(text).toContain("c.operational_location='appointments'");
      expect(text).toContain("not exists(select 1 from appointment_outcomes final");
    }
  });

  it("keeps past appointment evidence available after files leave the appointment queue", async () => {
    await appointmentPage(session, "past");
    const statements = state.statements.filter(({ text }) => text.includes("from appointments a join clients c"));
    expect(statements).toHaveLength(2);
    expect(statements.every(({ text }) => !text.includes("operational_location"))).toBe(true);
    expect(statements.every(({ text }) => text.includes("a.status in ('attended','missed','cancelled') or a.ends_at < now()"))).toBe(true);
  });

  it("applies the same location boundary to the legacy appointment reader", async () => {
    await appointmentList(session, "active");
    expect(state.statements.at(-1)?.text).toContain("c.operational_location='appointments'");
    state.statements.length = 0;
    await appointmentList(session, "past");
    expect(state.statements.at(-1)?.text).not.toContain("operational_location");
  });

  it.each(["open", "overdue", "due_today"])("excludes held and Urgent clients from %s tasks while retaining office tasks", async (view) => {
    await taskList(session, view);
    await taskPage(session, view);
    const statements = state.statements.filter(({ text }) => text.includes("from tasks t left join clients c"));
    expect(statements).toHaveLength(3);
    expect(statements.every(({ text }) => text.includes("t.client_id is null or c.operational_location not in ('manager','urgent','completed','cancelled','deleted')"))).toBe(true);
  });

  it("keeps completed task history independent of the client's current queue", async () => {
    await taskList(session, "closed");
    await taskPage(session, "closed");
    const statements = state.statements.filter(({ text }) => text.includes("from tasks t left join clients c"));
    expect(statements).toHaveLength(3);
    expect(statements.every(({ text }) => !text.includes("operational_location"))).toBe(true);
    expect(statements.every(({ text }) => text.includes("t.status in ('completed','cancelled')"))).toBe(true);
  });

  it.each(["today", "overdue", "upcoming"])("excludes held and Urgent clients from %s follow-ups", async (view) => {
    await followupList(session, view);
    await followupPage(session, view);
    const statements = state.statements.filter(({ text }) => text.includes("from followups f join clients c"));
    expect(statements).toHaveLength(3);
    expect(statements.every(({ text }) => text.includes("c.operational_location not in ('manager','urgent','completed','cancelled','deleted')"))).toBe(true);
  });

  it("retains completed follow-up history after a file is transferred", async () => {
    await followupList(session, "completed");
    await followupPage(session, "completed");
    const statements = state.statements.filter(({ text }) => text.includes("from followups f join clients c"));
    expect(statements).toHaveLength(3);
    expect(statements.every(({ text }) => !text.includes("operational_location"))).toBe(true);
    expect(statements.every(({ text }) => text.includes("f.status = 'completed'"))).toBe(true);
  });

  it("places payment and paperwork in distinct pipeline columns even when their detailed status matches", async () => {
    state.pipelineClients.push(
      { id: "payment", current_status: "screening_pending", pipeline_stage: "post_interview_completion", operational_location: "payment_required", fee_amount: "100" },
      { id: "paperwork", current_status: "screening_pending", pipeline_stage: "payment_required", operational_location: "paperwork_pending", fee_amount: "100" },
    );
    const result = await activePipelineData(session);
    expect(result.clients.map(({ id, pipeline_stage }) => ({ id, pipeline_stage }))).toEqual([
      { id: "payment", pipeline_stage: "payment_required" },
      { id: "paperwork", pipeline_stage: "post_interview_completion" },
    ]);
    const reads = state.statements.filter(({ text }) => text.includes("from clients"));
    expect(reads).toHaveLength(2);
    expect(reads.every(({ text }) => text.includes("operational_location not in ('manager','urgent'"))).toBe(true);
  });
});
