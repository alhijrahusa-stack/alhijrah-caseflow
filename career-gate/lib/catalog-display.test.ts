import { describe, expect, it } from "vitest";
import fixture from "@/e2e/fixtures/job-catalog.test.json";
import { activeOptions, catalog, options as validatedOptions, parseCatalog } from "@/lib/catalog";
import { catalogDisplayOptions, options } from "@/lib/catalog-display";
import { WORKSITE_OPTIONS as validatedWorksites } from "@/lib/worksite-change-schema";
import { buildWorksiteOptions, WORKSITE_OPTIONS } from "@/lib/worksite-options";

describe("browser catalog display without runtime validators", () => {
  it("keeps committed selections identical to the server-validated catalog", () => {
    expect(options).toEqual(validatedOptions);
    expect(WORKSITE_OPTIONS).toEqual(validatedWorksites);
    expect(WORKSITE_OPTIONS).toEqual(buildWorksiteOptions(catalog.facilities));
  });

  it("keeps sparse catalog defaults and published facts identical to the validated fixture", () => {
    const parsed = parseCatalog(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("Fixture catalog is invalid");
    const displayed = catalogDisplayOptions(fixture);
    expect(displayed).toEqual(activeOptions(parsed.data));
    expect(displayed).toHaveLength(3);
    expect(displayed.find(option => option.shift_code === "S9")).toMatchObject({
      hours: null, days: null, shift_name: null, employment_type: null,
      pay: null, pay_detail: { pay_type: null, base_pay_min: null, pay_source_url: null },
    });
  });
});
