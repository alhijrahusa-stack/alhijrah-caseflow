import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentVisionCircuitState, resetDocumentVisionCircuitForTest, rowsFromImageOrPdfDetailed } from "@/lib/universal-intake";

const validPayload = JSON.stringify({
  clients: [{
    full_name: "Test Client", phone: "2025550101", email: "test@example.com", date_of_birth: null,
    preferred_language: null, street: null, city: null, state: null, zip: null, appointment_availability: null,
    amazon_worked_before: null, amazon_worked_from: null, amazon_worked_to: null, amazon_applied_before: null,
    amazon_application_email: null, currently_amazon: null, via_agency: null, employment_kind: null, company: null,
    job_title: null, employment_from: null, employment_to: null, site_code: null, job_id: null, shift_code: null,
    backup_site_code: null, backup_job_id: null, backup_shift_code: null,
  }],
});

describe("document provider circuit breaker", () => {
  beforeEach(() => resetDocumentVisionCircuitForTest());

  it("opens after three consecutive Gemini request failures and routes the next extraction directly to OpenAI", async () => {
    let now = 1_000;
    const gemini = vi.fn(async () => ({ ok: false as const, code: "PROVIDER_ERROR" as const, message: "quota", model: "configured-gemini" }));
    const openai = vi.fn(async () => ({ ok: true as const, text: validPayload, model: "configured-openai" }));
    const deps = { gemini, openai, now: () => now };

    for (let i = 0; i < 3; i += 1) {
      const result = await rowsFromImageOrPdfDetailed(new Uint8Array([1]), "image/png", deps);
      expect(result.telemetry.provider).toBe("openai");
      now += 10;
    }

    expect(documentVisionCircuitState().state).toBe("OPEN");
    const geminiCallsBefore = gemini.mock.calls.length;
    const result = await rowsFromImageOrPdfDetailed(new Uint8Array([1]), "image/png", deps);
    expect(result.telemetry.fallback_used).toBe(true);
    expect(result.telemetry.attempts[0]).toMatchObject({ provider: "gemini", result: "SKIPPED", code: "CIRCUIT_OPEN" });
    expect(gemini).toHaveBeenCalledTimes(geminiCallsBefore);
    expect(openai).toHaveBeenCalledTimes(4);
  });

  it("resets the breaker after a successful Gemini extraction", async () => {
    const gemini = vi.fn(async () => ({ ok: true as const, text: validPayload, model: "configured-gemini" }));
    const openai = vi.fn(async () => ({ ok: true as const, text: validPayload, model: "configured-openai" }));
    const result = await rowsFromImageOrPdfDetailed(new Uint8Array([1]), "image/png", { gemini, openai, now: () => Date.now() });
    expect(result.telemetry.provider).toBe("gemini");
    expect(documentVisionCircuitState()).toMatchObject({ state: "CLOSED", consecutive_failures: 0 });
    expect(openai).not.toHaveBeenCalled();
  });
});
