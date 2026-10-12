import { describe, expect, it } from "vitest";
import { applicantIdentity, hasIdentitySignal, sameApplicant } from "@/lib/applicant-identity";

function matches(a: { fullName?: string; dateOfBirth?: string; phone?: string },
                 b: { fullName?: string; dateOfBirth?: string; phone?: string }) {
  return sameApplicant(applicantIdentity(a), applicantIdentity(b));
}

describe("one Career Gate applicant identity policy", () => {
  it("rejects name-only, DOB-only, or phone-only identity evidence", () => {
    expect(matches({ fullName: "Sara Doe" }, { fullName: "sara doe" })).toBe(false);
    expect(matches({ dateOfBirth: "1990-02-12" }, { dateOfBirth: "1990-02-12" })).toBe(false);
    expect(matches({ phone: "3135551212" }, { phone: "313-555-1212" })).toBe(false);
  });

  it("blocks identical names with matching canonical DOB", () => {
    expect(matches(
      { fullName: " SARA   DOE ", dateOfBirth: "1990-02-12" },
      { fullName: "sara doe", dateOfBirth: "1990-02-12" },
    )).toBe(true);
  });

  it("allows different applicants sharing email, phone, or contact details", () => {
    expect(matches(
      { fullName: "Brother A", dateOfBirth: "1990-02-12", phone: "3135551212" },
      { fullName: "Sister B", dateOfBirth: "1995-07-21", phone: "3135551212" },
    )).toBe(false);
  });

  it("blocks two corroborating signals where there is no contradictory evidence", () => {
    expect(matches(
      { fullName: "Client One", phone: "3135551212" },
      { fullName: "CLIENT ONE", phone: "313-555-1212" },
    )).toBe(true);
    expect(matches(
      { dateOfBirth: "1990-02-12", phone: "3135551212" },
      { dateOfBirth: "1990-02-12", phone: "(313) 555-1212" },
    )).toBe(true);
  });

  it("does not block when a verified name or DOB contradicts the proposed match", () => {
    expect(matches(
      { fullName: "Client One", dateOfBirth: "1990-02-12", phone: "3135551212" },
      { fullName: "Client One", dateOfBirth: "1999-02-12", phone: "3135551212" },
    )).toBe(false);
    expect(matches(
      { fullName: "Client One", dateOfBirth: "1990-02-12", phone: "3135551212" },
      { fullName: "Client Two", dateOfBirth: "1990-02-12", phone: "3135551212" },
    )).toBe(false);
  });

  it("does not use short common phone fragments as a second identity signal", () => {
    expect(matches(
      { fullName: "Client One", phone: "55512" },
      { fullName: "Client One", phone: "55512" },
    )).toBe(false);
  });

  it("normalizes whitespace, case and phone punctuation", () => {
    const identity = applicantIdentity({
      fullName: "  Example   NAME ", dateOfBirth: "2001-03-09", phone: "+1 (313) 555-1212",
    });
    expect(identity).toEqual({
      fullName: "example name", dateOfBirth: "2001-03-09", phone: "13135551212",
    });
    expect(hasIdentitySignal(identity)).toBe(true);
  });
});
