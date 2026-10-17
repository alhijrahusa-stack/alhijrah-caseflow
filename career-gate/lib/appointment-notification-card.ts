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
const isConfirmed = (status: string) => status === "confirmed";
export function renderAppointmentCard(input: AppointmentCard) {
  if (!input.clientName.trim() || !input.date.trim() || !input.location.trim()) throw new Error("Missing appointment details");
  if (!isConfirmed(input.status)) throw new Error("Only confirmed appointments can generate confirmations");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error("Client email required");
  const selected = [...new Set(input.documents)].map(id => DOCUMENTS.find(d => d.id === id)).filter((d): d is (typeof DOCUMENTS)[number] => Boolean(d));
  if (selected.length !== input.documents.length && new Set(input.documents).size !== selected.length) throw new Error("Invalid document selection");
  const section = (lang: "ar" | "en") => {
    const ar = lang === "ar";
    const label = ar ? ["تأكيد موعد مقابلة العمل","الاسم","الموعد","الموقع","المستندات المطلوب إحضارها","بيانات الاتصال المعتمدة","البريد الإلكتروني","رقم الجوال","هذه المعلومات مخصصة للمستلم المعني، ويُرجى عدم مشاركتها مع الغير."] :
      ["Job Interview Appointment Confirmation","Client","Date and Time","Location","Documents to Bring","Registered Contact Information","Email","Mobile","This information is intended for the designated recipient. Please do not share it with others."];
    const field = (name: string,value: string) => `<div class="field"><span class="key">${name}</span><strong>${esc(value)}</strong></div>`;
    return `<section lang="${lang}" dir="${ar ? "rtl" : "ltr"}"><h1>${label[0]}</h1>${field(label[1],input.clientName)}${field(label[2],input.date)}${field(label[3],input.location)}<h2>${label[4]}</h2><ul>${selected.map(d=>`<li>${esc(d[lang])}</li>`).join("")}</ul><h2>${label[5]}</h2>${field(label[6],input.email)}${field(label[7],input.phone)}<p class="privacy">${label[8]}</p></section>`;
  };
  const languages = input.language === "both" ? ["ar","en"] as const : [input.language];
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>section{padding:4px 0}h1{font-size:23px;line-height:1.5;color:#ffad4b;margin:0 0 20px}h2{font-size:16px;color:#ffad4b;margin:20px 0 10px}.field{padding:11px 0;border-bottom:1px solid #36516a;overflow-wrap:anywhere}.key{display:block;font-size:12px;color:#c2d1e1;margin-bottom:5px}.field strong{font-size:15px;font-weight:600}ul{padding-inline-start:22px;margin:8px 0}li{margin:7px 0;font-size:14px}.privacy{color:#c2d1e1;font-size:12px;line-height:1.8;margin-top:22px}</style></head><body style="margin:0;background:#071b31;color:#f5f8ff;font-family:Arial,Tahoma,sans-serif"><div style="max-width:640px;margin:auto;padding:28px 16px"><header style="text-align:center;padding:24px"><strong style="font-size:26px;color:#f59b31">CAREER GATE</strong><div>EMPLOYMENT SERVICES | خدمات التوظيف</div></header><main style="border:1px solid #56718c;border-radius:20px;background:#102c48;padding:24px">${languages.map(section).join('<hr style="border:0;border-top:1px solid #56718c;margin:26px 0">')}</main><footer style="padding:20px 0;text-align:center"><a href="https://wa.me/13139194292" style="display:inline-block;background:#17654e;color:white;padding:12px;border-radius:12px;margin:4px">WhatsApp</a><a href="tel:+13133393566" style="display:inline-block;background:#174b87;color:white;padding:12px;border-radius:12px;margin:4px">Call</a><a href="mailto:careergate.official@gmail.com" style="display:inline-block;background:#b85d13;color:white;padding:12px;border-radius:12px;margin:4px">Email</a><p style="font-size:12px;color:#c4d2e0">© 2026 Career Gate</p></footer></div></body></html>`;
  const text = languages.map(lang => [lang === "ar" ? "تأكيد موعد مقابلة العمل" : "Job Interview Appointment Confirmation",input.clientName,input.date,input.location,...selected.map(d=>d[lang]),input.email,input.phone].join("\n")).join("\n\n");
  return { subject: input.language === "en" ? "Career Gate | Job Interview Confirmation" : "Career Gate | تأكيد موعد مقابلة العمل", html, text };
}
