export type WarehouseSite = {
  code: string; name: string; kind: string; address: string;
};
export const AMAZON_INTERVIEW_SITES: readonly WarehouseSite[] = [
  { code:"DTW1",name:"Romulus",kind:"Amazon Fulfillment Center",address:"32801 Ecorse Rd, Romulus, MI 48174" },
  { code:"DET6",name:"Detroit",kind:"Amazon Delivery Station",address:"20110 Woodward Ave, Detroit, MI 48203" },
  { code:"DET1",name:"Livonia",kind:"Amazon Fulfillment Center",address:"39000 Amrhein Rd, Livonia, MI 48150" },
  { code:"DET3",name:"Pontiac",kind:"Amazon Fulfillment Center",address:"1220 Featherstone Rd, Pontiac, MI 48342" },
  { code:"DDT9",name:"Canton",kind:"Amazon Delivery Station",address:"49000 Michigan Ave, Canton Township, MI 48188" },
  { code:"SMI1",name:"Hazel Park",kind:"Amazon Sub-Same-Day Delivery",address:"1400 E 10 Mile Rd Ste 190, Hazel Park, MI 48030" },
  { code:"DTW3",name:"Romulus Prescott",kind:"Amazon Fulfillment Center",address:"33701 Prescott St, Romulus, MI 48174" },
  { code:"DTW9",name:"Romulus Prescott",kind:"Amazon Sort Center",address:"33700 Prescott St, Romulus, MI 48174" },
  { code:"DGR3",name:"Sterling Heights",kind:"Amazon Delivery Station",address:"33600 Mound Rd, Sterling Heights, MI 48310" },
  { code:"DET2",name:"Shelby Township",kind:"Amazon Fulfillment Center",address:"50500 Mound Rd, Shelby Township, MI 48317" },
  { code:"DTW8",name:"Plymouth",kind:"Amazon Fulfillment Center",address:"9075 Haggerty Rd, Plymouth, MI 48170" },
] as const;
export function warehouseLocation(site: WarehouseSite) {
  return `${site.name} (${site.code}): ${site.kind} - ${site.address}`;
}
export function siteForLocation(location: string | null | undefined) {
  return AMAZON_INTERVIEW_SITES.find(site => location === warehouseLocation(site)) ?? null;
}
export function warehouseMapUrl(location: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
