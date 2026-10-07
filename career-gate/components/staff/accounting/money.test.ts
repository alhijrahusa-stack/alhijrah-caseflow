import { describe, expect, it } from "vitest";
import {
  CURRENCY_PRECISION,
  businessToday,
  formatMoney,
  formatPercent,
  methodLabel,
  parseAmount,
  previewDiscount,
  transactionLabel,
} from "@/components/staff/accounting/money";

describe("financial display and preview", () => {
  it("renders money at the currency precision the server contract uses", () => {
    expect(CURRENCY_PRECISION).toBe(2);
    expect(formatMoney(150)).toBe("$150.00");
    expect(formatMoney("120.5")).toBe("$120.50");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(null)).toBe("$0.00");
    expect(formatMoney(Number.NaN)).toBe("—");
  });

  it("renders a percentage without inventing trailing precision", () => {
    expect(formatPercent(20)).toBe("20%");
    expect(formatPercent(12.5)).toBe("12.5%");
    expect(formatPercent("7.2500")).toBe("7.25%");
  });

  // The preview must agree with what the server will compute, so the operator is
  // not shown one figure and charged another. The server rounds to 2 decimals
  // from the authoritative fee; this mirrors exactly that.
  it("previews a percentage discount the way the server computes it", () => {
    expect(previewDiscount("percentage", 20, 150)).toBe(30);
    expect(previewDiscount("percentage", 12.5, 150)).toBe(18.75);
    expect(previewDiscount("percentage", 100, 150)).toBe(150);
    expect(previewDiscount("percentage", 0, 150)).toBe(0);
    // 33.333% of 150 is 49.9995 — the server rounds to 50.00, and so does this.
    expect(previewDiscount("percentage", 33.333, 150)).toBe(50);
  });

  it("previews an amount discount at the currency precision", () => {
    expect(previewDiscount("amount", 30, 150)).toBe(30);
    expect(previewDiscount("amount", 30.456, 150)).toBe(30.46);
  });

  it("refuses to preview a value the server would reject", () => {
    expect(previewDiscount("percentage", 101, 150)).toBeNull();
    expect(previewDiscount("amount", -1, 150)).toBeNull();
    expect(previewDiscount("amount", Number.NaN, 150)).toBeNull();
  });

  it("parses an amount field without guessing", () => {
    expect(parseAmount("150")).toBe(150);
    expect(parseAmount(" 12.50 ")).toBe(12.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("labels transactions and methods without exposing database wording", () => {
    expect(transactionLabel("payment")).toBe("Payment");
    expect(transactionLabel("waiver")).toBe("Waiver");
    expect(methodLabel("bank_transfer")).toBe("Bank Transfer");
    expect(methodLabel(null)).toBe("—");
  });

  it("defaults a recorded date to the business day, not the browser's", () => {
    const today = businessToday();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const inDetroit = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Detroit", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    expect(today).toBe(inDetroit);
  });
});
