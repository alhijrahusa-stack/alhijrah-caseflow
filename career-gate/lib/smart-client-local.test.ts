import { describe, expect, it } from "vitest";
import { extractDeterministicClient, localDisplayIdentity } from "@/lib/smart-client-local";

describe("Smart Client deterministic local extraction", () => {
  it("extracts supported US client identity and address fields without AI", () => {
    const source = `BELAL MAHMOOD HAMOOD HUSS AL BAADANI
+1 (248) 361-5923
DOB: 12-12-1977
3092 GOODSON ST UNIT2
HAMTRAMCK, MI 48212-3678
saherkagdop@gmail.com
Shift: night`;

    const result = extractDeterministicClient(source);
    expect(result.row.full_name).toBe("BELAL MAHMOOD HAMOOD HUSS AL BAADANI");
    expect(result.row.phone).toBe("2483615923");
    expect(result.row.email).toBe("saherkagdop@gmail.com");
    expect(result.row.date_of_birth).toBe("1977-12-12");
    expect(result.row.street).toBe("3092 GOODSON ST UNIT2");
    expect(result.row.city).toBe("HAMTRAMCK");
    expect(result.row.state).toBe("MI");
    expect(result.row.zip).toBe("48212-3678");
    expect(result.row.shift_code).toBe("night");
    expect(result.evidence.length).toBeGreaterThanOrEqual(8);
  });

  it("does not invent an ambiguous two-digit-year DOB", () => {
    const result = extractDeterministicClient("Name: Test Client\nPhone: 313-555-0199\nDOB: 01-02-03");
    expect(result.row.date_of_birth).toBeUndefined();
    expect(result.row.full_name).toBe("Test Client");
    expect(result.row.phone).toBe("3135550199");
  });

  it("provides a real display identity before falling back to unknown", () => {
    expect(localDisplayIdentity("Name: Jane Example\nPhone: 313-555-0101")).toBe("Jane Example");
    expect(localDisplayIdentity("Email: person@example.com")).toBe("person@example.com");
  });
});
