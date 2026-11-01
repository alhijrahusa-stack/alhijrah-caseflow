import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { staffGuard } from "@/lib/staff-api";
import { getImportCase, getImportDocument } from "@/lib/smart-client-import";
import { assertImportNotArchived } from "@/lib/smart-import-archive";
import { GET, POST } from "@/app/api/staff/smart-client-import/route";

vi.mock("@/lib/jobs", () => ({ processJobs: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: vi.fn() }));
vi.mock("@/lib/staff-api", () => ({ staffGuard: vi.fn() }));

const id = "82f586ee-0fa5-4798-835b-5f0f44d3fd3e";
const reviewerId = "4dc41434-0d59-4c0e-bdb2-a5d615a72849";
const manager: StaffSession = {
  authUserId: "manager-auth",
  staff: { id: reviewerId, display_name: "Review Manager", email: null, role: "manager" },
};
const approved = { id, status: "APPROVED_FILE", archived_at: new Date(), created_by: reviewerId, created_client_id: "client-1", field_evidence: [], conflicts: [] };
const sourceDocument = { id, storage_reference: "private/source.pdf", original_filename: "source.pdf", mime_type: "application/pdf", import_case_id: id };

function database(row: Record<string, unknown>) {
  const query = vi.fn(async (parts: TemplateStringsArray) => {
    const text = parts.join("?").replace(/\s+/g, " ").trim();
    if (text.startsWith("select c.*,")) return [row];
    if (text.startsWith("select id,original_filename")) return [sourceDocument];
    if (text.startsWith("select display_name from staff")) return [{ display_name: "Review Manager" }];
    if (text.startsWith("select d.id,")) return [{ ...sourceDocument, status: row.status, archived_at: row.archived_at }];
    if (text.startsWith("select archived_at from client_import_cases")) return [{ archived_at: row.archived_at }];
    throw new Error(`Unexpected read query: ${text}`);
  });
  vi.mocked(sql).mockReturnValue(query as unknown as ReturnType<typeof sql>);
  return query;
}

const request = () => new Request(`https://careergate.example/api/staff/smart-client-import?id=${id}`);

describe("Smart Review approved archive read access", () => {
  beforeEach(() => vi.mocked(staffGuard).mockResolvedValue({ session: manager, response: null }));
  afterEach(() => vi.resetAllMocks());

  it("returns an approved archived file and its source documents for authenticated audit", async () => {
    database(approved);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, case: { id, status: "APPROVED_FILE", created_client_id: "client-1" }, documents: [sourceDocument] });
    expect(await getImportDocument(manager, id)).toMatchObject(sourceDocument);
  });

  it("retains archival denials for manually archived unapproved files and their document bytes", async () => {
    database({ ...approved, status: "UNDER_REVIEW", created_client_id: null });
    const response = await GET(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "archived" } });
    await expect(getImportCase(manager, id)).rejects.toMatchObject({ code: "archived", status: 409 });
    await expect(getImportDocument(manager, id)).rejects.toMatchObject({ code: "archived", status: 409 });
  });

  it("keeps archived approved files protected from every existing mutation", async () => {
    database(approved);
    await expect(assertImportNotArchived(id)).rejects.toMatchObject({ code: "archived", status: 409 });
    const response = await POST(new Request("https://careergate.example/api/staff/smart-client-import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", id }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "archived" } });
  });

  it("rejects unauthenticated and ordinary staff reads before looking up a case", async () => {
    const query = database(approved);
    const denial = Response.json({ ok: false }, { status: 401 });
    vi.mocked(staffGuard).mockResolvedValue({ session: null, response: denial });
    expect(await GET(request())).toBe(denial);
    vi.mocked(staffGuard).mockResolvedValue({ session: { ...manager, staff: { ...manager.staff, role: "staff" } }, response: null });
    expect((await GET(request())).status).toBe(403);
    await expect(getImportCase({ ...manager, staff: { ...manager.staff, role: "staff" } }, id)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(getImportDocument({ ...manager, staff: { ...manager.staff, role: "staff" } }, id)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.every(([parts]) => parts.join("?").includes("select permission_mode, custom_permissions"))).toBe(true);
  });
});
