import { describe, expect, it } from "vitest";
import { needsHuman, normalizeDate, reconcileDob, reconcileName } from "./reconcile";

describe("reconciliation", () => {
  it("normalizes common date formats and rejects impossible dates", () => {
    expect(normalizeDate("04/05/1990")).toBe("1990-04-05");
    expect(normalizeDate("1990-4-5")).toBe("1990-04-05");
    expect(normalizeDate("05 APR 1990")).toBe("1990-04-05");
    expect(normalizeDate("April 5, 1990")).toBe("1990-04-05");
    expect(normalizeDate("02/30/1990")).toBeNull();
    expect(normalizeDate("garbage")).toBeNull();
  });

  it("DOB: exact normalized match only", () => {
    expect(reconcileDob("1990-04-05", "04/05/1990").state).toBe("MATCH");
    expect(reconcileDob("1990-04-05", "04/06/1990").state).toBe("MISMATCH");
    expect(reconcileDob(null, "04/05/1990").state).toBe("UNVERIFIED");
  });

  it("names: exact, format variance, mismatch", () => {
    expect(reconcileName("Maria Lopez", "Maria Lopez").state).toBe("MATCH");
    expect(reconcileName("María López", "MARIA LOPEZ").state).toBe("FORMAT_VARIANCE");
    expect(reconcileName("Maria Lopez", "LOPEZ, MARIA").state).toBe("FORMAT_VARIANCE");
    expect(reconcileName("Maria Lopez", "Maria Elena Lopez").state).toBe("FORMAT_VARIANCE");
    const m = reconcileName("Maria Lopez", "Mario Lopes");
    expect(m.state).toBe("MISMATCH");
    expect(m.similarity).toBeGreaterThan(0.5); // similarity is reported but never yields MATCH
  });

  it("anything short of MATCH requires a human", () => {
    expect(needsHuman([reconcileDob("1990-04-05", "04/05/1990")])).toBe(false);
    expect(needsHuman([reconcileName("A B", "a b")])).toBe(true);
  });
});

describe("name variants across sources", async () => {
  const { compatibleNames, composeName, mostCompleteName } = await import("./reconcile");

  it("treats order, case, punctuation, initials and a missing middle name as one name", () => {
    expect(compatibleNames("DOE, JOHN MICHAEL", "John Michael Doe")).toBe(true);
    expect(compatibleNames("John M. Doe", "JOHN MICHAEL DOE")).toBe(true);
    expect(compatibleNames("John Doe", "DOE JOHN MICHAEL")).toBe(true);
    expect(compatibleNames("Abdullah Al-Muraisi", "ABDULLAH AL MURAISI")).toBe(true);
  });

  it("keeps different people, lone given names and initial-only matches apart", () => {
    expect(compatibleNames("John Doe", "Jane Doe")).toBe(false);
    expect(compatibleNames("John Doe", "John Smith")).toBe(false);
    expect(compatibleNames("John", "John Doe")).toBe(false);
    expect(compatibleNames("J Doe", "John Doe")).toBe(false);
    expect(compatibleNames("John Michael Doe", "John Robert Doe")).toBe(false);
  });

  it("proposes the most complete form and composes a name from its parts", () => {
    expect(mostCompleteName(["John Doe", "DOE, JOHN MICHAEL", "John M Doe"])).toBe("JOHN MICHAEL DOE");
    expect(mostCompleteName(["Mary-Ann O'Neil"])).toBe("Mary-Ann O'Neil");
    expect(mostCompleteName([])).toBeNull();
    expect(composeName("John", "Michael", "Doe")).toBe("John Michael Doe");
    expect(composeName("John", null, "Doe")).toBe("John Doe");
    expect(composeName(" John ", "  ", " Doe ")).toBe("John Doe");
    expect(composeName("John", "Michael", null)).toBeNull();
    expect(composeName(null, null, "Doe")).toBeNull();
  });
});
