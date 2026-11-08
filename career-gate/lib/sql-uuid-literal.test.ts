import { describe, expect, it } from "vitest";
import { sqlUuidLiteral } from "@/lib/sql-uuid-literal";

describe("closed-alphabet UUID read literal", () => {
  it("canonicalizes a complete UUID and accepts PostgreSQL's nil UUID", () => {
    expect(sqlUuidLiteral("A14D9EEE-9A74-4C2C-AB70-1E9C07DAB3AC")).toBe("'a14d9eee-9a74-4c2c-ab70-1e9c07dab3ac'::uuid");
    expect(sqlUuidLiteral("00000000-0000-0000-0000-000000000000")).toBe("'00000000-0000-0000-0000-000000000000'::uuid");
  });
  it.each([
    "", "null", "a14d9eee9a744c2cab701e9c07dab3ac", "{a14d9eee-9a74-4c2c-ab70-1e9c07dab3ac}",
    " a14d9eee-9a74-4c2c-ab70-1e9c07dab3ac", "a14d9eee-9a74-4c2c-ab70-1e9c07dab3ac\n",
    "a14d9eee-9a74-4c2c-ab70-1e9c07dab3ac' OR true--", "a14d9eee-9a74-4c2c-ab70-1e9c07dab3ac;select 1",
    "a14d9eee-9a74-4c2c-ab70-1e9c07dab3ac\\", "ａ14d9eee-9a74-4c2c-ab70-1e9c07dab3ac",
  ])("rejects untrusted or noncanonical input %j before SQL construction", value => {
    expect(() => sqlUuidLiteral(value)).toThrow("Invalid UUID read identity");
  });
  it("rejects a non-string at a runtime boundary", () => {
    expect(() => sqlUuidLiteral(null as unknown as string)).toThrow(TypeError);
  });
});
