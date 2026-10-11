import { afterEach, describe, expect, it, vi } from "vitest";
import { regulaExtract } from "@/lib/providers/regula";
import { microblinkExtract } from "@/lib/providers/microblink";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Regula Document Reader 9.9 adapter", () => {
  it("fails closed when the primary provider is not configured", async () => {
    vi.stubEnv("REGULA_DOCUMENT_READER_URL", "");
    const result = await regulaExtract({ data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" });
    expect(result).toMatchObject({ ok: false, code: "NOT_CONFIGURED", provider: "regula" });
  });

  it("preserves provider probability and provenance without inventing a confidence scale", async () => {
    vi.stubEnv("REGULA_DOCUMENT_READER_URL", "https://regula.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ContainerList: {
        List: [
          { OneCandidate: { DocumentName: "Driver License", ICAOCode: "USA" } },
          {
            Text: {
              fieldList: [
                {
                  fieldName: "Full Name",
                  value: "TEST CLIENT",
                  validityStatus: 1,
                  comparisonStatus: 3,
                  valueList: [{
                    value: "TEST CLIENT",
                    source: "Visual",
                    probability: 87.4,
                    pageIndex: 0,
                    fieldRect: { left: 10, top: 20, right: 120, bottom: 42 },
                  }],
                },
                {
                  fieldName: "Date of Birth",
                  value: "1990-04-05",
                  validityStatus: 1,
                  comparisonStatus: 3,
                  valueList: [{ value: "1990-04-05", source: "MRZ", probability: 99.1, pageIndex: 0 }],
                },
              ],
            },
          },
          { Status: { detailsOptical: { security: 1 } } },
          { ImageQualityCheckList: { List: [{ type: 1, result: 1, probability: 96.2, areas: { List: [] } }] } },
          { AuthenticityCheckList: { List: [{ Type: 4, Result: 1, ElementDiagnose: 1 }] } },
        ],
      },
      ProcessingFinished: 1,
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const result = await regulaExtract({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
      traceId: "test-trace",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.provider).toEqual({ name: "regula", version: "9.9" });
    expect(result.result.row.full_name).toBe("TEST CLIENT");
    expect(result.result.row.date_of_birth).toBe("1990-04-05");
    expect(result.result.confidence.full_name).toBe(87.4);
    expect(result.result.fieldEvidence[0]).toMatchObject({
      field_name: "full_name",
      provider_name: "regula",
      provider_version: "9.9",
      recognition_probability: 87.4,
      page_index: 0,
      trace_id: "test-trace",
    });
    expect(result.result.fieldEvidence[0].bounding_region).toEqual({ left: 10, top: 20, right: 120, bottom: 42 });
    expect(result.result.authenticity.overall).toBe("PASSED");
  });
});

describe("Microblink BlinkID Verify 4000.4.0 adapter", () => {
  it("requires explicit consent when configured for cloud verification", async () => {
    vi.stubEnv("MICROBLINK_VERIFY_URL", "https://us-east.verify.microblink.com");
    vi.stubEnv("MICROBLINK_VERIFY_MODE", "cloud");
    vi.stubEnv("MICROBLINK_VERIFY_AUTHORIZATION", "Basic test");
    const result = await microblinkExtract({
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/jpeg",
    });
    expect(result).toMatchObject({ ok: false, code: "CONSENT_REQUIRED", provider: "microblink" });
  });

  it("uses the v3 multipart verify endpoint and retains fallback provider version", async () => {
    vi.stubEnv("MICROBLINK_VERIFY_URL", "https://verify.test");
    vi.stubEnv("MICROBLINK_VERIFY_MODE", "self_hosted");
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      return new Response(JSON.stringify({
        verdict: "Accept",
        extraction: {
          fullName: { value: "TEST FALLBACK" },
          dateOfBirth: { value: "1988-08-08" },
          documentClassInfo: { country: "USA", type: "Id" },
        },
        failedChecks: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await microblinkExtract({
      data: new Uint8Array([4, 5, 6]),
      mimeType: "image/jpeg",
      filename: "id.jpg",
      traceId: "fallback-trace",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.provider).toEqual({ name: "microblink", version: "4000.4.0" });
    expect(result.result.row.full_name).toBe("TEST FALLBACK");
    expect(result.result.authenticity.overall).toBe("PASSED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://verify.test/api/v3/verify");
  });
});
