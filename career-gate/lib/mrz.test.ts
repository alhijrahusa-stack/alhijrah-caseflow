import { describe, expect, it } from "vitest";
import { findMrzLines, mrzCheckDigit, parseMrz } from "@/lib/mrz";

/**
 * ICAO Doc 9303 conformance.
 *
 * The vectors below are the published specimen MRZs from the standard and its public
 * documentation — the "UTOPIA / ERIKSSON, ANNA MARIA" specimen used throughout 9303.
 * They are test data by design, not any real person's document.
 */

/** TD3, 2 × 44 — the passport specimen. */
const TD3 = [
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
  "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
].join("\n");

/** TD2, 2 × 36. */
const TD2 = [
  "I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<",
  "D231458907UTO7408122F1204159<<<<<<<6",
].join("\n");

/** TD1, 3 × 30 — the identity-card layout used by PRC and EAD. */
const TD1 = [
  "I<UTOD231458907<<<<<<<<<<<<<<<",
  "7408122F1204159UTO<<<<<<<<<<<6",
  "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
].join("\n");

describe("the 9303 check digit", () => {
  it("computes the published field check digits", () => {
    // Each of these digits is printed in the TD3 specimen above.
    expect(mrzCheckDigit("L898902C3")).toBe(6);
    expect(mrzCheckDigit("740812")).toBe(2);
    expect(mrzCheckDigit("120415")).toBe(9);
    expect(mrzCheckDigit("ZE184226B<<<<<")).toBe(1);
  });

  it("applies the 7-3-1 weights in order", () => {
    // 1*7 + 2*3 + 3*1 = 16 → 6
    expect(mrzCheckDigit("123")).toBe(6);
    expect(mrzCheckDigit("")).toBe(0);
    // Filler contributes zero, so it changes the position but not the sum.
    expect(mrzCheckDigit("<<<")).toBe(0);
  });

  it("values letters as A=10 through Z=35", () => {
    expect(mrzCheckDigit("A")).toBe(0); // 10*7 = 70 → 0
    expect(mrzCheckDigit("Z")).toBe(5); // 35*7 = 245 → 5
  });

  it("refuses to compute over a character the standard does not allow", () => {
    expect(mrzCheckDigit("12 3")).toBeNull();
    expect(mrzCheckDigit("ABC-")).toBeNull();
  });
});

describe("TD3 passport", () => {
  const result = parseMrz(TD3);

  it("reads every field of the specimen", () => {
    expect(result).not.toBeNull();
    expect(result!.format).toBe("TD3");
    expect(result!.document_code).toBe("P");
    expect(result!.issuing_state).toBe("UTO");
    expect(result!.surname).toBe("ERIKSSON");
    expect(result!.given_names).toBe("ANNA MARIA");
    expect(result!.full_name).toBe("ANNA MARIA ERIKSSON");
    expect(result!.document_number).toBe("L898902C3");
    expect(result!.nationality).toBe("UTO");
    expect(result!.date_of_birth).toBe("1974-08-12");
    expect(result!.expiration_date).toBe("2012-04-15");
    expect(result!.sex).toBe("F");
    expect(result!.optional_data).toBe("ZE184226B");
  });

  it("verifies every check digit, including the composite", () => {
    expect(result!.checks.document_number.valid).toBe(true);
    expect(result!.checks.date_of_birth.valid).toBe(true);
    expect(result!.checks.expiration_date.valid).toBe(true);
    expect(result!.checks.optional_data!.valid).toBe(true);
    expect(result!.checks.composite.valid).toBe(true);
    expect(result!.verified).toBe(true);
  });

  it("reports exactly the fields whose own check digit verified", () => {
    expect(result!.verified_fields.sort()).toEqual(["date_of_birth", "document_number", "expiration_date"]);
  });
});

describe("TD2 and TD1", () => {
  it("reads and verifies the TD2 specimen", () => {
    const result = parseMrz(TD2);
    expect(result!.format).toBe("TD2");
    // The field is 9 characters; the 10th printed character is its check digit.
    expect(result!.document_number).toBe("D23145890");
    expect(result!.checks.document_number.printed).toBe(7);
    expect(result!.full_name).toBe("ANNA MARIA ERIKSSON");
    expect(result!.date_of_birth).toBe("1974-08-12");
    expect(result!.expiration_date).toBe("2012-04-15");
    expect(result!.verified).toBe(true);
  });

  it("reads and verifies the TD1 specimen, where the name is on the third line", () => {
    const result = parseMrz(TD1);
    expect(result!.format).toBe("TD1");
    expect(result!.document_code).toBe("I");
    expect(result!.document_number).toBe("D23145890");
    expect(result!.checks.document_number.printed).toBe(7);
    expect(result!.surname).toBe("ERIKSSON");
    expect(result!.given_names).toBe("ANNA MARIA");
    expect(result!.nationality).toBe("UTO");
    expect(result!.date_of_birth).toBe("1974-08-12");
    expect(result!.expiration_date).toBe("2012-04-15");
    expect(result!.sex).toBe("F");
    expect(result!.verified).toBe(true);
  });
});

describe("a corrupted MRZ is reported, never repaired", () => {
  it("fails the field check digit when one character is wrong", () => {
    // L898902C3 → L898902C4: the document number's own check digit no longer holds.
    const result = parseMrz(TD3.replace("L898902C36", "L898902C46"));
    expect(result!.checks.document_number.valid).toBe(false);
    expect(result!.verified).toBe(false);
    // And nothing is trusted, because the composite shifts with it.
    expect(result!.verified_fields).toEqual([]);
  });

  it("trusts no field when the composite fails, even if each field passes", () => {
    const result = parseMrz(TD3.replace("<<<<<10", "<<<<<11"));
    expect(result!.checks.document_number.valid).toBe(true);
    expect(result!.checks.composite.valid).toBe(false);
    expect(result!.verified).toBe(false);
    expect(result!.verified_fields).toEqual([]);
  });

  it("reports both the printed and the computed digit, so a reviewer can see why", () => {
    const result = parseMrz(TD3.replace("L898902C36", "L898902C46"));
    expect(result!.checks.document_number.printed).toBe(6);
    // 21*7+8*3+9*1+8*7+9*3+0*1+2*7+12*3+4*1 = 317 → 7
    expect(result!.checks.document_number.computed).toBe(7);
  });

  it("returns no date for an impossible one rather than a repaired date", () => {
    // 740832 is not a calendar date.
    const result = parseMrz(TD3.replace("7408122", "7408322"));
    expect(result!.date_of_birth).toBeNull();
    expect(result!.verified_fields).not.toContain("date_of_birth");
  });
});

describe("finding the band in real page text", () => {
  it("ignores ordinary printed text above the band", () => {
    const page = [
      "UNITED STATES OF AMERICA",
      "PASSPORT   Type P   Code USA",
      "Surname  ERIKSSON",
      TD3,
    ].join("\n");
    expect(parseMrz(page)?.document_number).toBe("L898902C3");
  });

  it("tolerates the spaces OCR introduces into the filler runs", () => {
    const spaced = TD3.split("\n").map((line) => line.replace(/<</g, "< <")).join("\n");
    expect(parseMrz(spaced)?.verified).toBe(true);
  });

  it("accepts the guillemets some readers emit for the filler character", () => {
    const guillemets = TD3.split("\n").map((line) => line.replace(/</g, "«")).join("\n");
    expect(parseMrz(guillemets)?.verified).toBe(true);
  });

  it("returns null for a document with no band at all", () => {
    expect(parseMrz("Full Name: Ahmed Mohammed\nPhone: 313-555-0100")).toBeNull();
    expect(parseMrz("")).toBeNull();
    expect(findMrzLines("short")).toEqual([]);
  });

  it("does not mistake a long ordinary line for a band", () => {
    expect(parseMrz("THIS IS A LONG LINE OF ORDINARY TEXT WITH NO FILLER AT ALL")).toBeNull();
  });

  it("resolves a two-digit birth year into the past and an expiry forward", () => {
    const result = parseMrz(TD3);
    // 74 is 1974, not 2074; 12 is 2012, not 1912.
    expect(result!.date_of_birth!.startsWith("19")).toBe(true);
    expect(result!.expiration_date!.startsWith("20")).toBe(true);
  });
});
