import { afterEach, describe, expect, it, vi } from "vitest";
import { assessExtraction, parseExtraction } from "./doc-intel";
import { detectMissing, runIntakeAgent } from "./intake-agent";

const client = {
  full_name: "Test Person", email: null, date_of_birth: null, street: null, city: "Dearborn", state: "MI", zip: null,
  appointment_availability: null, amazon_worked_before: true, amazon_worked_from: "2022-01-01", amazon_worked_to: null,
  amazon_applied_before: null, amazon_application_email: null, currently_amazon: null, via_agency: null,
};
const ctx = { preferences: 0, employment: 0, documents: [{ doc_type: "photo_id", status: "needs_reupload" }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("intake agent", () => {
  it("detects missing and conditional items without inventing values", () => {
    const codes = detectMissing(client, ctx).map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(["dob", "email", "address", "availability", "amazon_dates", "amazon_applied_before", "doc_photo_id", "doc_work_authorization", "reupload_photo_id"]));
    expect(codes).not.toContain("amazon_email");
  });

  it("reports NOT_CONFIGURED without a model and keeps deterministic findings", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const r = await runIntakeAgent(client, ctx);
    expect(r.llm.status).toBe("not_configured");
    expect(r.findings.message_draft).toContain("Date of birth");
  });

  it("retries once on invalid model JSON, then reports schema_invalid", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("OPENAI_AGENT_MODEL", "m");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: "not json" }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await runIntakeAgent(client, ctx);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r.llm.status).toBe("schema_invalid");
  });

  it("uses validated model wording but never lets it change findings", async () => {
    vi.stubEnv("OPENAI_API_KEY", "k");
    vi.stubEnv("OPENAI_AGENT_MODEL", "m");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ recommended_action: "Call client", message_draft: "Hi" }) }] }] }), { status: 200 })));
    const r = await runIntakeAgent(client, ctx);
    expect(r.llm.status).toBe("succeeded");
    expect(r.findings.missing_items).toEqual(detectMissing(client, ctx));
  });
});

describe("document extraction validation", () => {
  const good = { document_class: "photo_id", readable: true, fields: [
    { field_name: "full_name", raw_value: "TEST PERSON", normalized_value: "Test Person", source_page: 1, legible: true },
    { field_name: "date_of_birth", raw_value: "04/05/1990", normalized_value: "1990-04-05", source_page: 1, legible: true },
  ] };

  it("rejects invalid JSON and schema violations", () => {
    expect(parseExtraction("{").ok).toBe(false);
    expect(parseExtraction(JSON.stringify({ ...good, document_class: "passport_x" })).ok).toBe(false);
  });

  it("rejects outputs that carry a full SSN or long identifier", () => {
    const bad = { ...good, fields: [...good.fields, { field_name: "document_number_last4", raw_value: "123-45-6789", normalized_value: null, source_page: 1, legible: true }] };
    expect(parseExtraction(JSON.stringify(bad)).ok).toBe(false);
  });

  it("reconciles against the record and flags mismatches for human review", () => {
    const x = parseExtraction(JSON.stringify(good));
    expect(x.ok).toBe(true);
    if (!x.ok) return;
    const match = assessExtraction(x.value, "photo_id", { full_name: "Test Person", date_of_birth: "1990-04-05" });
    expect(match.recon.map((r) => r.state)).toEqual(["MATCH", "MATCH"]);
    const mismatch = assessExtraction(x.value, "photo_id", { full_name: "Other Name", date_of_birth: "1991-01-01" });
    expect(mismatch.recon.map((r) => r.state)).toEqual(["MISMATCH", "MISMATCH"]);
  });

  it("marks missing material fields (unreadable document)", () => {
    const x = parseExtraction(JSON.stringify({ document_class: "photo_id", readable: false, fields: [{ field_name: "full_name", raw_value: null, normalized_value: null, source_page: 1, legible: false }] }));
    if (!x.ok) throw new Error("parse");
    const a = assessExtraction(x.value, "photo_id", { full_name: "Test Person", date_of_birth: null });
    expect(a.unreadable).toBe(true);
    expect(a.missing).toEqual(["full_name", "date_of_birth"]);
  });
});
