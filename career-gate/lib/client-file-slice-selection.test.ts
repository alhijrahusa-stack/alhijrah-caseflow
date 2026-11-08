import { describe, expect, it } from "vitest";
import { parseClientFileSlices } from "@/lib/queries";

describe("client-file reader selection", () => {
  it("accepts own reader names only, deduplicating them without accepting prototype properties", () => {
    expect(parseClientFileSlices(["client", "toString", "constructor", "__proto__", "notes", "client", "hasOwnProperty", "missing"])).toEqual(["client", "notes"]);
  });
});
