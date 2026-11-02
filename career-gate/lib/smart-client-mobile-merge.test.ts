import { describe, expect, it } from "vitest";
import { mergeEvidence } from "@/lib/smart-client-mobile";

const text = (row: Record<string, string>) => ({ row, source: "local_text", documentId: null, sourcePage: null });
const doc = (row: Record<string, string>, id = "00000000-0000-4000-8000-000000000001") => ({ row, source: "document", documentId: id, sourcePage: 1 });

describe("mobile import name evidence", () => {
  it("one person written differently across a note and a driver's license is proposed, not a conflict", () => {
    const result = mergeEvidence([text({ full_name: "John Doe" }), doc({ full_name: "DOE, JOHN MICHAEL" })]);
    expect(result.merged.full_name).toBe("JOHN MICHAEL DOE");
    expect(result.conflicts.filter((c) => c.field_key === "full_name")).toHaveLength(0);
    const states = result.evidence.filter((e) => e.field_key === "full_name").map((e) => e.verification_state);
    expect(states).toEqual(["REVIEW", "REVIEW"]);
  });

  it("a license that gives the name in parts still supplies the full name", () => {
    const result = mergeEvidence([doc({ first_name: "John", middle_name: "M", last_name: "Doe" })]);
    expect(result.merged.full_name).toBe("John M Doe");
  });

  it("two different people stay a conflict and no name is proposed", () => {
    const result = mergeEvidence([text({ full_name: "John Doe" }), doc({ full_name: "Jane Doe" })]);
    expect(result.merged.full_name).toBeUndefined();
    expect(result.conflicts.filter((c) => c.field_key === "full_name")).toHaveLength(1);
  });
});
