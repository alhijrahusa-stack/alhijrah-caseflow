import { describe, expect, it } from "vitest";
import { renderAppointmentEmail } from "./appointment-email";

describe("automatic field appointment confirmation",()=>{
  it("renders a safely escaped bilingual appointment email with Michigan time, site and map",()=>{
    const r=renderAppointmentEmail({
      appointmentId:"00000000-0000-0000-0000-000000000001",
      recipient:"applicant@example.com",
      recipientKind:"client",
      clientName:"A <script>alert(1)</script> CLIENT",
      scheduledAt:"2026-11-03T18:00:00Z",
      location:"Romulus (DTW1): Amazon Fulfillment Center - 32801 Ecorse Rd, Romulus, MI 48174",
      appointmentType:"Employment interview",
      event:"scheduled",
    });
    expect(r.subject).toContain("Appointment Confirmation");
    expect(r.text).toContain("arrive 30 minutes early");
    expect(r.text).toContain("الوثائق الأصلية");
    expect(r.text).toContain("Nov");
    expect(r.html).toContain("www.google.com/maps/search");
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain("Google Maps");
  });
  it("names updates and reminders correctly",()=>{
    const payload={
      appointmentId:"00000000-0000-0000-0000-000000000001",
      recipient:"applicant@example.com",
      recipientKind:"client" as const,
      clientName:"Test User",scheduledAt:"2026-11-03T18:00:00Z",
      location:"Office",appointmentType:"Office intake",
    };
    expect(renderAppointmentEmail({...payload,event:"updated"}).subject).toContain("Updated");
    expect(renderAppointmentEmail({...payload,event:"reminder"}).subject).toContain("24 hours");
  });
});
