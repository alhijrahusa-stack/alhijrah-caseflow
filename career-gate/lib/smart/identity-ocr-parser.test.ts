import { describe, expect, it } from "vitest";
import { parseIdentityLines } from "@/lib/smart/identity-ocr-parser";

describe("document identity parser V2", () => {
  it("extracts two-line legal name and exact DOB without inventing a phone", () => {
    const parsed=parseIdentityLines([
      {text:"SURNAME",score:0.98},{text:"DOE",score:0.97},
      {text:"GIVEN NAME",score:0.98},{text:"JANE MARIE",score:0.97},
      {text:"DOB",score:0.94},{text:"02/13/1995",score:0.92},
      {text:"CARD EXPIRES",score:0.95},{text:"02/13/2035",score:0.96},
    ]);
    expect(parsed.row).toMatchObject({full_name:"JANE MARIE DOE",date_of_birth:"1995-02-13",expiration_date:"2035-02-13"});
    expect(parsed.row.phone).toBeUndefined();
    expect(parsed.provenance.full_name).toContain("SURNAME");
  });
  it("rejects impossible dates and low-confidence evidence", () => {
    const parsed=parseIdentityLines([{text:"DOB: 02/31/1990",score:0.99},{text:"NAME: FAKE VALUE",score:0.2}]);
    expect(parsed.row).toEqual({});
  });
  it("does not interpret unrelated capital letters as identity information", () => {
    expect(parseIdentityLines([{text:"UNITED STATES OF AMERICA",score:0.99},{text:"PERMANENT RESIDENT",score:0.99}]).row).toEqual({});
  });
});

describe("a machine readable zone outranks the label patterns", () => {
  /** The published ICAO 9303 TD3 specimen — test data by design, not a real person. */
  const TD3 = [
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
  ];
  const lines = (texts: readonly string[], score = 0.72) => texts.map((text) => ({ text, score }));

  it("reads a passport the label patterns cannot read at all", () => {
    // No printed labels anywhere: without the band this document yields nothing.
    const result = parseIdentityLines(lines(TD3));
    expect(result.row.full_name).toBe("ANNA MARIA ERIKSSON");
    expect(result.row.date_of_birth).toBe("1974-08-12");
    expect(result.row.expiration_date).toBe("2012-04-15");
  });

  it("records the band as the provenance, and arithmetic as the confidence", () => {
    const result = parseIdentityLines(lines(TD3));
    expect(result.provenance.date_of_birth).toBe("TD3 machine readable zone, check digits verified");
    expect(result.confidence.date_of_birth).toBe(1);
  });

  it("beats a label that disagrees with the verified band", () => {
    // OCR misread the printed date; the band's check digit did not.
    const result = parseIdentityLines(lines(["DATE OF BIRTH: 07/408/1974", ...TD3, "DOB: 01/02/1990"]));
    expect(result.row.date_of_birth).toBe("1974-08-12");
  });

  it("contributes nothing when the band's check digits fail", () => {
    const corrupted = [TD3[0], TD3[1].replace("<<<<<10", "<<<<<11")];
    const result = parseIdentityLines(lines(corrupted));
    // The band is not trusted and is not repaired; the document reads as unlabelled.
    expect(result.row.full_name).toBeUndefined();
    expect(result.row.date_of_birth).toBeUndefined();
  });

  it("leaves a document with no band entirely to the label patterns", () => {
    const result = parseIdentityLines(lines(["FULL NAME: Ahmed Mohammed", "DOB: 05/14/1995"]));
    expect(result.row.full_name).toBe("Ahmed Mohammed");
    expect(result.row.date_of_birth).toBe("1995-05-14");
    expect(result.provenance.full_name).not.toMatch(/machine readable/);
  });

  it("still applies the low-confidence floor to the label patterns around a band", () => {
    // A verified band is arithmetic, so it is not subject to the OCR score floor,
    // while an unverified label beside it still is.
    const result = parseIdentityLines([
      ...lines(TD3, 0.95),
      { text: "CITY: Detroit", score: 0.2 },
    ]);
    expect(result.row.full_name).toBe("ANNA MARIA ERIKSSON");
    expect(result.row.city).toBeUndefined();
  });
});
