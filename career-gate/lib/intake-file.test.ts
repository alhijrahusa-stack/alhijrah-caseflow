import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/intake-file";

describe("intake file parser", () => {
  it("parses quoted CSV fields and preserves source headers", () => {
    const rows = parseCsv('full_name,phone,email\n"Doe, Jane",3135550199,jane@example.com\n');
    expect(rows).toEqual([{ full_name: "Doe, Jane", phone: "3135550199", email: "jane@example.com" }]);
  });

  it("supports embedded newlines and duplicate column names deterministically", () => {
    const rows = parseCsv('name,name,phone\n"Jane\nDoe",Alias,3135550199');
    expect(rows).toEqual([{ name: "Jane\nDoe", name_2: "Alias", phone: "3135550199" }]);
  });

  it("returns no rows for a header-only file", () => {
    expect(parseCsv("full_name,phone\n")).toEqual([]);
  });
});
