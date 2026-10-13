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
