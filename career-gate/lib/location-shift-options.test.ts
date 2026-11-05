import { describe, expect, it } from "vitest";
import { AMAZON_LOCATIONS, locationIndexForCode, locationSiteCode, matchLocations } from "@/lib/location-shift-options";

describe("location directory", () => {
  it("maps indexes and site codes both ways and rejects codes outside the directory", () => {
    expect(locationSiteCode(0)).toBe("MI_LOC_01");
    expect(locationSiteCode(16)).toBe("MI_LOC_17");
    AMAZON_LOCATIONS.forEach((_, index) => expect(locationIndexForCode(locationSiteCode(index))).toBe(index));
    for (const code of [null, undefined, "", "MI_LOC_00", "MI_LOC_18", "MI_LOC_1", "DTW3", "MI_LOC_01x"]) expect(locationIndexForCode(code)).toBe(-1);
  });

  it("searches by name, building code, street and ZIP, every word required", () => {
    expect(matchLocations("").length).toBe(AMAZON_LOCATIONS.length);
    expect(matchLocations("dtw3").map(l => l.name)).toEqual(["Romulus (DTW3)"]);
    expect(matchLocations("pontiac").map(l => l.name)).toEqual(["Pontiac", "Pontiac (DDT6)"]);
    expect(matchLocations("mound").map(l => l.name)).toEqual(["Shelby Township", "Sterling Heights"]);
    expect(matchLocations("48174").map(l => l.name)).toEqual(["Romulus", "Romulus (DTW3)"]);
    expect(matchLocations("romulus prescott").map(l => l.name)).toEqual(["Romulus (DTW3)"]);
    expect(matchLocations("  CANTON ").map(l => l.name)).toEqual(["Canton"]);
    expect(matchLocations("nowhere")).toEqual([]);
  });

  it("ranks names that start with the search before addresses that contain it", () => {
    const results = matchLocations("ca").map(l => l.name);
    expect(results.slice(0, 3)).toEqual(["Caledonia", "Caledonia (GRR5)", "Canton"]);
  });
});
