import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffSession } from "@/lib/auth";
import { staffGuard } from "@/lib/staff-api";
import { getImportDocument } from "@/lib/smart-client-import";
import { downloadObjectStream, StorageNotConfigured } from "@/lib/storage";
import { GET } from "@/app/api/staff/smart-client-import/document/[id]/route";

vi.mock("@/lib/staff-api", () => ({ staffGuard: vi.fn() }));
vi.mock("@/lib/smart-client-import", () => ({ getImportDocument: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  downloadObjectStream: vi.fn(),
  StorageNotConfigured: class StorageNotConfigured extends Error {},
}));

const id = "82f586ee-0fa5-4798-835b-5f0f44d3fd3e";
const manager: StaffSession = {
  authUserId: "manager-auth",
  staff: { id: "manager-1", display_name: "Review Manager", email: null, role: "manager" },
};
const document = { id, storage_reference: "smart-import/private/document.pdf", original_filename: "Client identity.pdf", mime_type: "application/pdf", import_case_id: "case-1" };
const context = (documentId = id) => ({ params: Promise.resolve({ id: documentId }) });
const request = (headers?: HeadersInit) => new Request(`https://careergate.example/api/staff/smart-client-import/document/${id}`, { headers });

describe("Smart Review authenticated document preview", () => {
  beforeEach(() => {
    vi.mocked(staffGuard).mockResolvedValue({ session: manager, response: null });
    vi.mocked(getImportDocument).mockResolvedValue(document);
    vi.mocked(downloadObjectStream).mockResolvedValue(new Response("%PDF-1.7", { headers: { "content-length": "8", "accept-ranges": "bytes" } }));
  });
  afterEach(() => vi.resetAllMocks());

  it("returns an authentication denial before looking up or downloading a private document", async () => {
    const denial = Response.json({ ok: false }, { status: 401 });
    vi.mocked(staffGuard).mockResolvedValue({ session: null, response: denial });
    expect(await GET(request(), context())).toBe(denial);
    expect(getImportDocument).not.toHaveBeenCalled();
    expect(downloadObjectStream).not.toHaveBeenCalled();
  });

  it("denies ordinary staff without reading document metadata or storage", async () => {
    vi.mocked(staffGuard).mockResolvedValue({ session: { ...manager, staff: { ...manager.staff, role: "staff" } }, response: null });
    const response = await GET(request(), context());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(getImportDocument).not.toHaveBeenCalled();
    expect(downloadObjectStream).not.toHaveBeenCalled();
  });

  it("rejects a malformed document ID before accessing metadata or storage", async () => {
    const response = await GET(request(), context("not-a-uuid"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_id" } });
    expect(getImportDocument).not.toHaveBeenCalled();
    expect(downloadObjectStream).not.toHaveBeenCalled();
  });

  it("refuses active HTML content even when a stored document declares that MIME type", async () => {
    vi.mocked(getImportDocument).mockResolvedValue({ ...document, mime_type: "text/html" });
    const response = await GET(request(), context());
    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { code: "unsupported_preview" } });
    expect(downloadObjectStream).not.toHaveBeenCalled();
  });

  it("streams PDF bytes on the authenticated origin with private preview security headers and no redirect", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("%PDF-1.7");
    expect(getImportDocument).toHaveBeenCalledWith(manager, id);
    expect(downloadObjectStream).toHaveBeenCalledWith(document.storage_reference, undefined);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe("inline; filename=\"Client identity.pdf\"; filename*=UTF-8''Client%20identity.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-length")).toBe("8");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  it("neutralizes unsafe filename characters without losing the encoded Unicode filename", async () => {
    vi.mocked(getImportDocument).mockResolvedValue({ ...document, original_filename: '../client"\r\nX-Evil: injected\\ملف.pdf' });
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    const disposition = response.headers.get("content-disposition")!;
    expect(disposition).not.toMatch(/[\r\n\\/]/);
    expect(disposition).toMatch(/^inline; filename="[^"\r\n]*"; filename\*=UTF-8''/);
    expect(disposition).toContain(encodeURIComponent("ملف.pdf"));
    expect(response.headers.has("x-evil")).toBe(false);
  });

  it("forwards a PDF byte range and streams the partial response with its range metadata", async () => {
    vi.mocked(downloadObjectStream).mockResolvedValue(new Response("PDF", {
      status: 206, headers: { "content-range": "bytes 1-3/100", "content-length": "3", "accept-ranges": "bytes" },
    }));
    const response = await GET(request({ range: "bytes=1-3" }), context());
    expect(downloadObjectStream).toHaveBeenCalledWith(document.storage_reference, "bytes=1-3");
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-3/100");
    expect(response.headers.get("content-length")).toBe("3");
    expect(await response.text()).toBe("PDF");
  });

  it("rejects invalid multipart ranges before downloading any bytes", async () => {
    const response = await GET(request({ range: "bytes=1-2,4-5" }), context());
    expect(response.status).toBe(416);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_range" } });
    expect(downloadObjectStream).not.toHaveBeenCalled();
  });

  it("preserves an unsatisfiable storage range without relaying the private storage response body", async () => {
    vi.mocked(downloadObjectStream).mockResolvedValue(new Response("private storage error", { status: 416, headers: { "content-range": "bytes */100" } }));
    const response = await GET(request({ range: "bytes=1000-" }), context());
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */100");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("");
  });

  it("returns a configured storage failure without leaking credentials or upstream details", async () => {
    vi.mocked(downloadObjectStream).mockRejectedValue(new StorageNotConfigured("private credential detail"));
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private credential detail");
  });

  it("keeps the global frame denial and places the narrow same-origin document override last", async () => {
    const require = createRequire(import.meta.url);
    const config = require("../next.config.js") as { headers(): Promise<{ source: string; headers: { key: string; value: string }[] }[]> };
    const rules = await config.headers();
    expect(rules[0].headers).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    const documentRule = rules.at(-1)!;
    expect(documentRule.source).toBe("/api/staff/smart-client-import/document/:id");
    expect(documentRule.headers).toContainEqual({ key: "X-Frame-Options", value: "SAMEORIGIN" });
    expect(documentRule.headers.find((header) => header.key === "Content-Security-Policy")?.value).toContain("frame-ancestors 'self'");
  });
});
