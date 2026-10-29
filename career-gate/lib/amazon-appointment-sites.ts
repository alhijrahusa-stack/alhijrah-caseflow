export const AMAZON_APPOINTMENT_SITES = [
  { code:"DTW1", city:"Romulus", name:"Amazon Fulfillment Center", address:"32801 Ecorse Rd, Romulus, MI 48174" },
  { code:"DET6", city:"Detroit", name:"Amazon Delivery Station", address:"20110 Woodward Ave, Detroit, MI 48203" },
  { code:"DET1", city:"Livonia", name:"Amazon Fulfillment Center", address:"39000 Amrhein Rd, Livonia, MI 48150" },
  { code:"DET3", city:"Pontiac", name:"Amazon Fulfillment Center", address:"1220 Featherstone Rd, Pontiac, MI 48342" },
  { code:"DDT9", city:"Canton", name:"Amazon Delivery Station", address:"49000 Michigan Ave, Canton Township, MI 48188" },
  { code:"SMI1", city:"Hazel Park", name:"Amazon Sub-Same-Day Delivery", address:"1400 E 10 Mile Rd Ste 190, Hazel Park, MI 48030" },
  { code:"DTW3", city:"Romulus", name:"Amazon Fulfillment Center", address:"33701 Prescott St, Romulus, MI 48174" },
  { code:"DTW9", city:"Romulus", name:"Amazon Sort Center", address:"33700 Prescott St, Romulus, MI 48174" },
  { code:"DGR3", city:"Sterling Heights", name:"Amazon Delivery Station", address:"33600 Mound Rd, Sterling Heights, MI 48310" },
  { code:"DET2", city:"Shelby Township", name:"Amazon Fulfillment Center", address:"50500 Mound Rd, Shelby Township, MI 48317" },
  { code:"DTW8", city:"Plymouth", name:"Amazon Fulfillment Center", address:"9075 Haggerty Rd, Plymouth, MI 48170" },
] as const;

export type AmazonAppointmentSite = (typeof AMAZON_APPOINTMENT_SITES)[number];
export type AmazonAppointmentSiteCode = AmazonAppointmentSite["code"];

export function findAmazonAppointmentSite(code: string | null | undefined): AmazonAppointmentSite | null {
  return AMAZON_APPOINTMENT_SITES.find(site => site.code === code) ?? null;
}

export function amazonAppointmentMapsUrl(address: string): string {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(address);
}
