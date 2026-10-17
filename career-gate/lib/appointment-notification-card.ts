export const DOCUMENTS = [
  { id: "passport", ar: "جواز السفر الأمريكي الأصلي", en: "Original U.S. Passport" },
  { id: "green_card", ar: "بطاقة الإقامة الدائمة الأصلية سارية الصلاحية", en: "Valid Original Permanent Resident Card" },
  { id: "ead", ar: "وثيقة تصريح العمل", en: "Employment Authorization Document (EAD)" },
  { id: "social_security", ar: "بطاقة الضمان الاجتماعي الأصلية", en: "Original Social Security Card" },
  { id: "state_id", ar: "بطاقة الهوية الصادرة عن الولاية", en: "State ID" },
  { id: "driver_license", ar: "رخصة القيادة", en: "Driver's License" },
  { id: "citizenship", ar: "شهادة الجنسية", en: "Certificate of Citizenship" },
] as const;
export type DocumentId = (typeof DOCUMENTS)[number]["id"];
export type NotificationLanguage = "ar" | "en" | "both";
export type AppointmentCard = {
  clientName: string; date: string; location: string; status: string;
  email: string; phone: string; documents: DocumentId[]; language: NotificationLanguage;
};

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const titleCase = (name: string) => name.trim().replace(/\s+/g, " ").replace(/[A-Za-z][A-Za-z'-]*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
const box = (content: string, style = "") => '<div style="background:#122c49;border:1px solid #365477;border-radius:15px;padding:16px 18px;' + style + '">' + content + '</div>';
const caption = (value: string) => '<div style="color:#afc4dc;font-size:12px;font-weight:600;letter-spacing:.3px;margin-bottom:7px">' + value + '</div>';
const detail = (label: string, value: string, special = "") =>
  box(caption(label) + '<div style="font-size:17px;line-height:1.7;font-weight:700;color:#fff;overflow-wrap:anywhere;' + special + '">' + esc(value) + '</div>');
const contact = (href: string, name: string, color: string) =>
  '<a href="' + href + '" style="display:inline-block;text-decoration:none;background:' + color + ';color:#fff;border:1px solid #ffffff22;border-radius:12px;padding:12px 17px;margin:5px;font-size:13px;font-weight:700">' + name + '</a>';

export function renderAppointmentCard(input: AppointmentCard) {
  if (!input.clientName.trim() || !input.date.trim() || !input.location.trim()) throw new Error("Missing appointment details");
  if (input.status !== "confirmed") throw new Error("Only confirmed appointments can generate confirmations");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error("Client email required");
  if (input.documents.some(id => !DOCUMENTS.some(d => d.id === id))) throw new Error("Invalid document selection");
  const selected = [...new Set(input.documents)].map(id => DOCUMENTS.find(d => d.id === id)!);
  const name = titleCase(input.clientName);
  const section = (lang: "ar" | "en") => {
    const ar = lang === "ar";
    const heading = ar ? "تأكيد موعد مقابلة العمل" : "Job Interview Confirmation";
    const greeting = ar ? "الأستاذ/ " + name : "Dear " + name + ",";
    const intro = ar
      ? "نُثمن اختياركم لبوابة التوظيف Career Gate، ويسعدنا إبلاغكم بتأكيد موعد المقابلة الوظيفية الخاصة بكم، وفق البيانات المعتمدة أدناه."
      : "Thank you for choosing Career Gate. We are pleased to confirm your job interview appointment with the verified details below.";
    const label = ar
      ? ["اسم المتقدم","تاريخ ووقت الموعد","الموقع","المستندات المطلوب إحضارها","بيانات التواصل","البريد الإلكتروني","رقم الهاتف","هذه التذكرة مخصصة لصاحب الموعد. يرجى الاحتفاظ بها وعدم مشاركة بياناتها مع الآخرين."]
      : ["Applicant Name","Appointment Date & Time","Location","Required Documents","Contact Details","Email Address","Phone Number","This pass is intended only for the named applicant. Please keep it secure and do not share its details."];
    const docs = selected.length
      ? selected.map(d => '<div style="margin:8px 0;padding:11px 13px;background:#183a5c;border:1px solid #365477;border-radius:10px;font-size:14px;line-height:1.65;color:#f5f9ff">✓ ' + esc(d[lang]) + '</div>').join("")
      : '<div style="color:#bfd0e2;font-size:14px">' + (ar ? "لم تُحدد مستندات إضافية لهذا الموعد." : "No additional documents specified for this appointment.") + '</div>';
    const subheading = (v: string) => '<h2 style="color:#f4b85e;font-size:15px;font-weight:800;letter-spacing:.2px;margin:24px 0 12px">' + v + '</h2>';
    return '<section lang="' + lang + '" dir="' + (ar ? "rtl" : "ltr") + '" style="padding:7px 0">'
      + '<div style="display:inline-block;background:#254364;color:#f4b85e;border:1px solid #6b664d;border-radius:100px;padding:7px 13px;font-size:11px;font-weight:800;letter-spacing:1px">✓ ' + (ar ? "موعد مؤكد" : "CONFIRMED APPOINTMENT") + '</div>'
      + '<h1 style="font-size:24px;line-height:1.5;color:#ffbf68;margin:15px 0 12px;font-weight:800">' + heading + '</h1>'
      + '<div style="font-size:17px;font-weight:800;color:#fff;margin:0 0 10px">' + esc(greeting) + '</div>'
      + '<p style="font-size:14px;line-height:2;color:#d9e6f4;margin:0 0 21px">' + intro + '</p>'
      + '<div style="display:grid;grid-template-columns:1fr;gap:10px">'
      + detail(label[0],name) + detail(label[1],input.date,"font-variant-numeric:tabular-nums;") + detail(label[2],input.location)
      + '</div>' + subheading(label[3]) + box(docs,"background:#0d2540;")
      + subheading(label[4]) + detail(label[5],input.email) + '<div style="height:9px"></div>' + detail(label[6],input.phone)
      + '<div style="margin-top:24px;background:#292b34;border:1px solid #9b7b43;border-radius:14px;padding:14px 16px;color:#f2d8a7;font-size:12px;line-height:1.9">◆ ' + label[7] + '</div>'
      + '</section>';
  };
  const languages = input.language === "both" ? (["ar","en"] as const) : [input.language];
  // Inline SVG wordmark is decorative; the text brand remains visible in email clients that strip SVG.
  const emblem = '<svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="0 0 48 48" role="img" aria-label="Career Gate"><defs><linearGradient id="cg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd18b"/><stop offset="1" stop-color="#f58d24"/></linearGradient></defs><rect x="3" y="3" width="42" height="42" rx="12" fill="#153451" stroke="#c58e48"/><path d="M14 34V14h20v20M20 34V21h8v13" fill="none" stroke="url(#cg)" stroke-width="3" stroke-linecap="round"/></svg>';
  const header = '<header style="text-align:center;padding:25px 16px 27px;border-bottom:1px solid #3e5670;background:linear-gradient(135deg,#10283f,#183b59)">'
    + '<div style="margin-bottom:10px">' + emblem + '</div>'
    + '<div style="font-size:27px;line-height:1.25;font-weight:900;letter-spacing:2px;color:#ffae48">CAREER GATE</div>'
    + '<div lang="ar" dir="rtl" style="font-size:17px;font-weight:800;color:#fff;margin-top:6px">بوابة التوظيف</div>'
    + '<div style="font-size:10px;letter-spacing:2px;color:#b9cce0;margin-top:7px">EXECUTIVE SMART GATE PASS</div></header>';
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Career Gate Appointment Confirmation</title></head>'
    + '<body style="margin:0;padding:0;background:#071725;color:#fff;font-family:Arial,Tahoma,sans-serif;-webkit-font-smoothing:antialiased">'
    + '<div style="max-width:660px;margin:0 auto;padding:25px 12px">'
    + '<div style="border:1px solid #6c7690;border-radius:24px;overflow:hidden;background:#0c223a;box-shadow:0 15px 45px #0007">'
    + header + '<main style="padding:22px 24px 26px;background:linear-gradient(160deg,#102b49,#0a2038)">'
    + languages.map(section).join('<div style="height:1px;background:#47627d;margin:30px 0"></div>') + '</main></div>'
    + '<footer style="text-align:center;padding:22px 0">'
    + contact("https://wa.me/13139194292","WhatsApp","#176a55")
    + contact("tel:+13133393566","Call / اتصال","#25578d")
    + contact("mailto:careergate.official@gmail.com","Email / بريد","#a7601c")
    + '<div style="font-size:11px;color:#9db4cb;margin-top:13px">CAREER GATE · بوابة التوظيف</div></footer></div></body></html>';
  const text = languages.map(lang => {
    const ar = lang === "ar";
    return [ar ? "بوابة التوظيف | تأكيد موعد مقابلة العمل" : "CAREER GATE | Job Interview Confirmation",
      ar ? "الأستاذ/ " + name : "Dear " + name + ",",
      ar ? "نُثمن اختياركم لبوابة التوظيف Career Gate، ويسعدنا تأكيد موعد المقابلة الوظيفية الخاصة بكم." : "Thank you for choosing Career Gate. Your job interview appointment is confirmed.",
      input.date,input.location,...selected.map(d => d[lang]),input.email,input.phone,
      ar ? "هذه التذكرة مخصصة لصاحب الموعد." : "This pass is intended for the named applicant."].join("\n");
  }).join("\n\n");
  return {subject: input.language === "en" ? "Career Gate | Job Interview Confirmation" : "Career Gate | تأكيد موعد مقابلة العمل",html,text};
}
