/** User-supplied location directory. These are selection preferences, not live job availability. */
export const AMAZON_LOCATIONS = [
["Romulus","32801 Ecorse Rd, Romulus, MI 48174"],
["Romulus (DTW3)","33701 Prescott St, Romulus, MI 48174"],
["Lansing","6500 W Mt Hope Hwy, Lansing, MI 48917"],
["Caledonia","4500 68th St SE, Caledonia, MI 49316"],
["Caledonia (GRR5)","6665 Patterson Ave SE, Caledonia, MI 49316"],
["Detroit","20110 Woodward Ave, Detroit, MI 48203"],
["Pontiac","1220 Featherstone Rd, Pontiac, MI 48342"],
["Pontiac (DDT6)","1300 Featherstone Rd, Pontiac, MI 48342"],
["Livonia","39000 Amrhein Rd, Livonia, MI 48150"],
["Shelby Township","50500 Mound Rd, Shelby Township, MI 48317"],
["Brownstown","19991 Brownstown Center Dr, Brownstown Charter Twp, MI 48183"],
["Plymouth","12795 Premier Center Ct, Plymouth, MI 48170"],
["Canton","49000 Michigan Ave, Canton, MI 48188"],
["Hazel Park","1400 E 10 Mile Rd, Hazel Park, MI 48030"],
["Sterling Heights","33600 Mound Rd, Sterling Heights, MI 48310"],
["Walker","2935 Walkent Ct NW, Walker, MI 49544"],
["Saginaw","3280 Commerce Centre Dr, Saginaw, MI 48601"],
] as const;
export const SHIFT_TYPES = [
["morning","Morning Shift / وردية الصباح"],
["night","Night Shift / وردية الليل"],
["front_half","Front Half / النصف الأول"],
["back_half","Back Half / النصف الثاني"],
["mid","Mid-Shift / المنتصف"],
["reduced","Reduced Time (RT) / مخفض"],
["weekend","Weekend Shift / نهاية الأسبوع"],
["flex","Flex Shift / مرنة"],
["met","MET / وقت إضافي إلزامي"],
] as const;
export const DAY_PATTERNS = [
["sun-wed","Sunday – Wednesday / الأحد – الأربعاء"],
["mon-thu","Monday – Thursday / الاثنين – الخميس"],
["tue-fri","Tuesday – Friday / الثلاثاء – الجمعة"],
["wed-sat","Wednesday – Saturday / الأربعاء – السبت"],
["thu-sat","Thursday – Saturday / الخميس – السبت"],
["fri-sun","Friday – Sunday / الجمعة – الأحد"],
["sat-sun","Saturday – Sunday / السبت – الأحد"],
["custom","Custom / اختيار أيام مخصصة"],
] as const;
/** Suggested patterns only; do not imply a shift is available at a location. */
export const SHIFT_DEFAULT_DAYS: Record<string,string> = {
 front_half:"sun-wed", back_half:"wed-sat", reduced:"thu-sat", weekend:"sat-sun",
};
export const SHIFT_DEFAULT_HOURS: Record<string,string> = {
 morning:"07:00 AM – 05:30 PM", night:"06:30 PM – 05:00 AM",
 front_half:"07:00 AM – 05:30 PM", back_half:"06:30 PM – 05:00 AM",
 mid:"08:00 AM – 04:30 PM", reduced:"06:30 PM – 07:00 AM",
 weekend:"07:00 AM – 05:30 PM", flex:"Variable, 3–5h blocks", met:"Additional 1–2h or workday",
};
