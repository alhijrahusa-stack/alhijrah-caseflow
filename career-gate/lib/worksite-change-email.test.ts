import { describe, expect, it } from "vitest";
import { renderWorksiteChangeEmail, worksiteChangeEmailKey, type WorksiteChangeEmailPayload } from "@/lib/worksite-change-email";

const payload: WorksiteChangeEmailPayload = {
  changeId: "e25e4475-a919-46c0-b63a-0c5cac22acc2", clientName: "TEST <script>Applicant</script>", clientRef: "TEST-WS-0001",
  recipient: "worksite@test.invalid", currentSiteName: "Previous Site", finalSiteName: "Confirmed New Site",
  finalSiteAddress: "123 Test Street, Michigan", shiftDays: "Wednesday – Saturday", shiftStart: "18:30", shiftEnd: "05:00",
  newStartDate: "2026-11-15", confirmedAt: "2026-11-08T19:30:00Z", timezone: "America/Detroit",
};
describe("institutional worksite confirmation email", () => {
  it("includes the confirmed site, full schedule, start date and Michigan confirmation time in both formats", () => {
    const mail = renderWorksiteChangeEmail(payload);
    expect(mail.subject).toContain(payload.clientRef);
    expect(mail.text).toContain("نؤكد لكم إتمام تغيير موقع العمل");
    for (const format of [mail.text,mail.html]) {
      for (const value of [payload.finalSiteName,payload.finalSiteAddress,payload.shiftDays,payload.shiftStart,payload.shiftEnd,"Nov 15, 2026","2:30 PM","America/Detroit"]) expect(format).toContain(value);
    }
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("https://www.google.com/maps/search/");
    expect(mail.text).toContain("ALHIJRAH VISA & IMMIGRATION SERVICES LLC");
  });
  it("uses one stable provider identity per confirmed decision and rejects incomplete notice data", () => {
    expect(worksiteChangeEmailKey(payload.changeId)).toBe(worksiteChangeEmailKey(payload.changeId));
    expect(worksiteChangeEmailKey(payload.changeId)).not.toBe(worksiteChangeEmailKey("777c9bfd-d276-4f22-8caa-b52311efc53c"));
    expect(() => renderWorksiteChangeEmail({...payload,finalSiteAddress:""})).toThrow();
    expect(() => renderWorksiteChangeEmail({...payload,recipient:"invalid"})).toThrow();
  });
});
