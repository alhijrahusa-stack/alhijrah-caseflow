import { describe, expect, it } from "vitest";
import { DOCUMENTS, renderAppointmentCard } from "./appointment-notification-card";
const sample = {
 clientName: "Test Client", date: "October 17, 2026, 12:30 PM (America/Detroit)",
 location: "32801 Ecorse Rd, Romulus, MI 48174", status: "confirmed",
 email: "client@example.com", phone: "3130000000",
 documents: ["green_card", "social_security"] as ("green_card" | "social_security")[],
 language: "both" as const,
};
describe("appointment notification card", () => {
 it("renders bilingual selected documents and official contact actions", () => {
   const card = renderAppointmentCard(sample);
   expect(card.html).toContain('lang="ar" dir="rtl"');
   expect(card.html).toContain('lang="en" dir="ltr"');
   expect(card.html).toContain("Original Social Security Card");
   expect(card.html).not.toContain("Original U.S. Passport");
   expect(card.html).toContain("https://wa.me/13139194292");
   expect(card.html).toContain("tel:+13133393566");
   expect(card.html).toContain("mailto:careergate.official@gmail.com");
 });
 it("escapes client data", () => {
   const card = renderAppointmentCard({...sample, clientName: '<script>alert("x")</script>'});
   expect(card.html).not.toContain("<script>");
   expect(card.html).toContain("&lt;script&gt;");
 });
 it("rejects non-confirmed appointments and missing email", () => {
   expect(() => renderAppointmentCard({...sample,status:"scheduled"})).toThrow();
   expect(() => renderAppointmentCard({...sample,email:""})).toThrow();
 });
 it("supports Arabic-only and English-only delivery", () => {
   expect(renderAppointmentCard({...sample,language:"ar"}).html).not.toContain('lang="en"');
   expect(renderAppointmentCard({...sample,language:"en"}).html).not.toContain('lang="ar"');
 });
 it("offers exactly the seven configured document options", () => {
   expect(DOCUMENTS).toHaveLength(7);
 });
});
