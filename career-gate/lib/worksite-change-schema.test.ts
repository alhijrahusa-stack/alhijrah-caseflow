import { describe, expect, it } from "vitest";
import { parseWorksiteDays, WorksiteChangeInput, WORKSITE_OPTIONS } from "@/lib/worksite-change-schema";

describe("confirmed work schedule input", () => {
  it("resolves named English and Arabic ranges into the canonical stored weekdays", () => {
    expect(parseWorksiteDays("Wednesday – Saturday")).toEqual(["WED","THU","FRI","SAT"]);
    expect(parseWorksiteDays("الأربعاء – السبت")).toEqual(["WED","THU","FRI","SAT"]);
    expect(parseWorksiteDays("FRI-MON")).toEqual(["FRI","SAT","SUN","MON"]);
    expect(parseWorksiteDays("Sunday, Tuesday, Thursday")).toEqual(["SUN","TUE","THU"]);
    expect(parseWorksiteDays("الأحد، الثلاثاء، الخميس")).toEqual(["SUN","TUE","THU"]);
    expect(parseWorksiteDays("MON MON FRI")).toEqual(["MON","FRI"]);
  });
  it("does not invent days from missing or unknown shift patterns", () => {
    for(const value of ["","Front Half","Every weekday except Thursday","Sunday-next week","Wednesday–unknown"])expect(parseWorksiteDays(value)).toBeNull();
  });
  it("rejects non-catalog locations, invalid calendar dates and invalid local times", () => {
    const valid={operation:"confirm",operation_id:"11111111-1111-4111-8111-111111111111",client_id:"22222222-2222-4222-8222-222222222222",
      expected_updated_at:"2026-11-08",current_site_code:WORKSITE_OPTIONS[0].code,requested_site_code:WORKSITE_OPTIONS[1].code,
      final_site_code:WORKSITE_OPTIONS[2].code,shift_days:"Wednesday – Saturday",shift_start:"18:30",shift_end:"05:00",
      new_start_date:"2026-11-18",confirmed_at:"2026-11-07T19:30:00Z"};
    expect(WorksiteChangeInput.safeParse(valid).success).toBe(true);
    for(const patch of [{final_site_code:"FORGED"},{new_start_date:"2026-02-30"},{shift_start:"25:00"},{shift_days:"Unspecified"}])expect(WorksiteChangeInput.safeParse({...valid,...patch}).success).toBe(false);
  });
});
