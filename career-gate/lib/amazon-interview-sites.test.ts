import { describe, expect, it } from "vitest";
import { AMAZON_INTERVIEW_SITES, siteForLocation, warehouseLocation, warehouseMapUrl } from "./amazon-interview-sites";

describe("Career Gate Michigan warehouse directory", () => {
  it("contains the eleven approved location codes without duplicates", () => {
    const codes=AMAZON_INTERVIEW_SITES.map(site=>site.code);
    expect(codes).toEqual(["DTW1","DET6","DET1","DET3","DDT9","SMI1","DTW3","DTW9","DGR3","DET2","DTW8"]);
    expect(new Set(codes).size).toBe(codes.length);
    for(const site of AMAZON_INTERVIEW_SITES) {
      expect(site.address).toMatch(/MI \d{5}$/);
      expect(siteForLocation(warehouseLocation(site))).toEqual(site);
      expect(warehouseMapUrl(site.address)).toContain("https://www.google.com/maps/search/");
    }
  });
  it("does not automatically treat arbitrary office text as a verified Amazon site",()=>{
    expect(siteForLocation("Office")).toBeNull();
    expect(siteForLocation("32801 Ecorse Rd")).toBeNull();
  });
});
