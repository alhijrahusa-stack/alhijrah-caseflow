import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { absoluteTrackingUrl, renderConfirmationEmail } from "./postmark";

const payload = {
  clientName: "Test Client",
  caseNumber: "ALH-20261001-TEST",
  submittedAt: "2026-10-01T03:00:00.000Z",
  trackingUrl: "/career-gate.html?track=1&case=ALH-20261001-TEST",
  service: "Employment Services",
  email: "client@example.com",
  phone: "+1 313 555 0100",
  workType: "Full-Time",
  shiftName: "FHD",
  shiftDays: "Sunday - Wednesday",
  shiftHours: "07:00 AM - 05:30 PM",
  expectedPay: "$20.50 / hr",
  branchName: "Romulus - DTW1",
  branchAddress: "32801 Ecorse Rd, Romulus, MI 48174",
};

beforeEach(() => {
  process.env.CAREER_GATE_PUBLIC_URL = "https://alhijrah-caseflow.vercel.app";
});

afterEach(() => {
  delete process.env.CAREER_GATE_PUBLIC_URL;
});

describe("Career Gate confirmation email", () => {
  it("builds the canonical absolute case-tracking URL", () => {
    expect(absoluteTrackingUrl(payload.trackingUrl, payload.caseNumber)).toBe(
      "https://alhijrah-caseflow.vercel.app/career-gate.html?track=1&case=ALH-20261001-TEST",
    );
  });

  it("renders the English transactional receipt with a clickable case-status CTA", () => {
    const email = renderConfirmationEmail("en", payload);
    expect(email.subject).toBe("Career Gate — Application Received — ALH-20261001-TEST");
    expect(email.html).toContain("CASE STATUS");
    expect(email.html).toContain("CHECK YOUR CASE STATUS");
    expect(email.html).toContain(`href="${email.trackingUrl}"`);
    expect(email.html).toContain("ALH-20261001-TEST");
  });

  it("renders the Arabic transactional receipt and preserves canonical data values", () => {
    const email = renderConfirmationEmail("ar", payload);
    expect(email.subject).toBe("Career Gate — تم استلام طلبك — ALH-20261001-TEST");
    expect(email.html).toContain("اضغط هنا لمتابعة حالة ملفك");
    expect(email.html).toContain("client@example.com");
    expect(email.html).toContain("ALH-20261001-TEST");
  });

  it("contains only the safe receipt summary and never introduces sensitive intake fields", () => {
    const email = renderConfirmationEmail("en", payload);
    const combined = `${email.html}\n${email.text}`;
    expect(combined).not.toContain("Date of Birth");
    expect(combined).not.toContain("signature.png");
    expect(combined).not.toContain("upload_token");
    expect(combined).not.toContain("client_id");
    expect(combined).not.toContain("auth");
  });
});
