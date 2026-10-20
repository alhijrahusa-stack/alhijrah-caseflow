import { describe, expect, it } from "vitest";
import { parseFieldVital, routePattern, screenClass } from "@/lib/field-vitals";

const base = { name: "INP", value: 184.4, rating: "good", route: "/staff/client/02caec63-e239-40bf-8d3a-ccbdfa374a4a", screen: "phone", navigation: "navigate" };

describe("field vitals", () => {
  it("reduces a page to its route pattern", () => {
    expect(routePattern("/staff/client/02caec63-e239-40bf-8d3a-ccbdfa374a4a?tab=activity")).toBe("/staff/client/[id]");
    expect(routePattern("/staff/import/12/review")).toBe("/staff/import/[n]/review");
    expect(routePattern("/staff/pipeline")).toBe("/staff/pipeline");
  });

  it("classifies the screen by width", () => {
    expect(screenClass(390)).toBe("phone");
    expect(screenClass(1024)).toBe("tablet");
    expect(screenClass(1920)).toBe("desktop");
  });

  it("accepts a well-formed report and strips record ids", () => {
    expect(parseFieldVital(base)).toEqual({ ...base, value: 184, route: "/staff/client/[id]" });
    expect(parseFieldVital({ ...base, name: "CLS", value: 0.012345 })?.value).toBe(0.0123);
    expect(parseFieldVital({ ...base, navigation: "<script>" })?.navigation).toBe("unknown");
  });

  it("rejects anything else", () => {
    for (const bad of [
      null, "INP", {}, { ...base, name: "FID" }, { ...base, value: -1 }, { ...base, value: Number.NaN },
      { ...base, value: "184" }, { ...base, rating: "great" }, { ...base, screen: "watch" }, { ...base, route: "/apply" },
    ]) expect(parseFieldVital(bad)).toBeNull();
  });
});
