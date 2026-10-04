import { describe, expect, it } from "vitest";
import { extractDeterministicClient, localDisplayIdentity } from "@/lib/smart-client-local";

describe("Smart Client deterministic local extraction", () => {
  it("extracts an unlabeled production-style client block without treating the first arbitrary line as the name", () => {
    const source = `night
BELAL MAHMOOD HAMOOD HUSS AL BAADANI
+1 (248) 361-5923
12-12-1977
3092 GOODSON ST UNIT2
HAMTRAMCK, MI 48212-3678
saherkagdop@gmail.com`;

    const result = extractDeterministicClient(source);
    expect(result.row.full_name).toBe("BELAL MAHMOOD HAMOOD HUSS AL BAADANI");
    expect(result.row.phone).toBe("2483615923");
    expect(result.row.email).toBe("saherkagdop@gmail.com");
    expect(result.row.date_of_birth).toBe("1977-12-12");
    expect(result.row.street).toBe("3092 GOODSON ST UNIT2");
    expect(result.row.city).toBe("HAMTRAMCK");
    expect(result.row.state).toBe("MI");
    expect(result.row.zip).toBe("48212-3678");
    expect(result.evidence.length).toBeGreaterThanOrEqual(7);
    expect(localDisplayIdentity(source)).toBe("BELAL MAHMOOD HAMOOD HUSS AL BAADANI");
  });

  it("extracts explicit supported operational fields across the full source text", () => {
    const source = `Name: Jane Marie Doe
Phone: 313-555-0198
Email: JANE.DOE@EXAMPLE.COM
DOB: 1989/04/23
Address: 4558 Chovin St
City: Dearborn
State: mi
ZIP: 48126
Language: Arabic
Availability: Weekdays after 3 PM
Site: DTW1
Job ID: JOB-123
Shift: NIGHT-A`;

    const result = extractDeterministicClient(source);
    expect(result.row).toMatchObject({
      full_name: "Jane Marie Doe",
      phone: "3135550198",
      email: "jane.doe@example.com",
      date_of_birth: "1989-04-23",
      street: "4558 Chovin St",
      city: "Dearborn",
      state: "MI",
      zip: "48126",
      preferred_language: "Arabic",
      appointment_availability: "Weekdays after 3 PM",
      site_code: "DTW1",
      job_id: "JOB-123",
      shift_code: "NIGHT-A",
    });
  });

  it("does not invent identity from unrelated operational text", () => {
    const result = extractDeterministicClient("night\navailable\nAmazon application\nhttps://example.com/status");
    expect(result.row.full_name).toBeUndefined();
    expect(result.display_name).toBeNull();
  });

  it("does not invent an ambiguous two-digit-year DOB", () => {
    const result = extractDeterministicClient("Name: Test Client\nPhone: 313-555-0199\nDOB: 01-02-03");
    expect(result.row.date_of_birth).toBeUndefined();
    expect(result.row.full_name).toBe("Test Client");
    expect(result.row.phone).toBe("3135550199");
  });

  it("rejects impossible calendar dates instead of normalizing them", () => {
    const result = extractDeterministicClient("Name: Test Person\nDOB: 02/31/1990");
    expect(result.row.date_of_birth).toBeUndefined();
  });

  it("provides a real display identity before falling back to unknown", () => {
    expect(localDisplayIdentity("Name: Jane Example\nPhone: 313-555-0101")).toBe("Jane Example");
    expect(localDisplayIdentity("Email: person@example.com")).toBe("person@example.com");
  });
});
