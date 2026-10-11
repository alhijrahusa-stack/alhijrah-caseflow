import { describe, expect, it } from "vitest";
import { mrzCheckDigit, validateMrz } from "@/lib/document-validation/mrz";

describe("ICAO Doc 9303 MRZ validation", () => {
  it("implements the 7-3-1 check digit algorithm", () => {
    expect(mrzCheckDigit("L898902C3")).toBe("6");
    expect(mrzCheckDigit("740812")).toBe("2");
    expect(mrzCheckDigit("120415")).toBe("9");
  });

  it("validates the ICAO TD3 sample", () => {
    const result = validateMrz([
      "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
      "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
    ]);
    expect(result.format).toBe("TD3");
    expect(result.valid).toBe(true);
    expect(result.checks.every((item) => item.passed)).toBe(true);
  });

  it("validates the ICAO TD1 sample", () => {
    const result = validateMrz([
      "I<UTOD231458907<<<<<<<<<<<<<<<",
      "7408122F1204159UTO<<<<<<<<<<<6",
      "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
    ]);
    expect(result.format).toBe("TD1");
    expect(result.valid).toBe(true);
  });

  it("detects a failed checksum instead of repairing it", () => {
    const result = validateMrz([
      "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
      "L898902C36UTO7408122F1204159ZE184226B<<<<<11",
    ]);
    expect(result.format).toBe("TD3");
    expect(result.valid).toBe(false);
    expect(result.checks.some((item) => !item.passed)).toBe(true);
  });

  it("does not guess the format for malformed input", () => {
    expect(validateMrz("NOT-A-MRZ")).toEqual({
      format: null,
      valid: null,
      checks: [],
      lines: ["NOT-A-MRZ"],
    });
  });
});
