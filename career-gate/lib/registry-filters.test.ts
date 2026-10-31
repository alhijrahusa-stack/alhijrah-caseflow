import { describe, expect, it } from "vitest";
import { normalizeRegistrySearch, parseRegistryFilters, registryFilterValues, registryHighlightParts, registryPageNumbers, registryPhoneSearchDigits } from "@/lib/registry-filters";

describe("registry filter contract",()=>{
  it("keeps the default reception scope identical for list and export; ignores unsupported role filters",()=>{
    expect(parseRegistryFilters(new URLSearchParams("q=Ahmed"),true)).toMatchObject({view:"active",stage:"new_intake",q:"Ahmed",page:1});
    expect(parseRegistryFilters(new URLSearchParams("view=completed&page=3"),true)).toMatchObject({view:"completed",stage:undefined,page:3});
    expect(parseRegistryFilters(new URLSearchParams("assigned=none"),false)).toMatchObject({view:"active",stage:"new_intake",assigned:undefined});
    expect(parseRegistryFilters(new URLSearchParams("view=all&stage=account_setup"),true)).toMatchObject({view:"active",stage:"account_setup"});
  });
  it("whitelists saved filter fields, validates owner IDs and removes pagination",()=>{
    expect(registryFilterValues(new URLSearchParams("view=all&assigned=anything&page=4&sql=drop&q=Ahmed&status=bogus"),true)).toEqual({view:"all",q:"Ahmed"});
    expect(parseRegistryFilters(new URLSearchParams("page=NaN"),true).page).toBe(1);
    expect(parseRegistryFilters(new URLSearchParams("page=-1"),true).page).toBe(1);
    expect(parseRegistryFilters(new URLSearchParams("page=1.5"),true).page).toBe(1);
    expect(parseRegistryFilters(new URLSearchParams("page=1e5"),true).page).toBe(1);
  });
  it("preserves very large positive stale pages for clamping by the actual server result count",()=>{
    expect(parseRegistryFilters(new URLSearchParams("page=9007199254740999"),true).page).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseRegistryFilters(new URLSearchParams(`page=${"9".repeat(400)}`),true).page).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseRegistryFilters(new URLSearchParams("page=99999"),true).page).toBe(99999);
  });
});

describe("multilingual search highlighting",()=>{
  it("searches digits as a phone only for phone-shaped input, never mixed names, references or emails",()=>{
    expect(registryPhoneSearchDigits("RegistryUX-mabc313xyz")).toBe("");
    expect(registryPhoneSearchDigits("Candidate 6401")).toBe("");
    expect(registryPhoneSearchDigits("CG-2026-000207")).toBe("");
    expect(registryPhoneSearchDigits("client313@example.com")).toBe("");
    expect(registryPhoneSearchDigits("+1 (313) 555-6401")).toBe("13135556401");
    expect(registryPhoneSearchDigits("555.6401")).toBe("5556401");
    expect(registryPhoneSearchDigits("313")).toBe("313");
    expect(registryPhoneSearchDigits("31")).toBe("");
  });
  it("normalizes Arabic diacritics and alef/ya variants while retaining the actual displayed text",()=>{
    const name="أَحْمَد مصطفى";
    expect(normalizeRegistrySearch(name)).toBe("احمد مصطفي");
    const parts=registryHighlightParts(name,"احمد");
    expect(parts.filter(part=>part.match).map(part=>part.text).join("")).toBe("أَحْمَد");
    expect(parts.map(part=>part.text).join("")).toBe(name);
  });
  it("highlights literal terms without treating metacharacters or HTML as executable syntax",()=>{
    expect(registryHighlightParts("Anne + Anne","anne")).toEqual([{text:"Anne",match:true},{text:" + ",match:false},{text:"Anne",match:true}]);
    expect(registryHighlightParts("<script>[A]", "[A]").filter(part=>part.match)).toEqual([{text:"[A]",match:true}]);
  });
  it("keeps page links bounded and includes the endpoints",()=>{
    expect(registryPageNumbers(1,1)).toEqual([1]);
    expect(registryPageNumbers(5,100)).toEqual([1,4,5,6,100]);
  });
});
