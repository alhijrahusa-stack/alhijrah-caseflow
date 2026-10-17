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
const titleCase = (name: string) => { const clean = name.trim().replace(/\s+/g, " "); return /[<>]/.test(clean) ? clean : clean.replace(/[A-Za-z][A-Za-z'-]*/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()); };
const palette = { background: "#040914", panel: "#0A122C", gold: "#C5A059", text: "#F7F5EF", muted: "#C9D4E4" };
const cell = (body: string, padding = "16px") => '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:separate;background-color:'+palette.panel+';border:1px solid #526078;border-radius:12px"><tr><td style="padding:'+padding+';font-family:Arial,Tahoma,sans-serif;overflow-wrap:break-word;word-break:break-word">'+body+'</td></tr></table>';
const labelText = (value: string) => '<div style="color:#C9D4E4;font-size:12px;font-weight:600;line-height:1.6;margin-bottom:5px">'+value+'</div>';
const detail = (label: string, value: string) => cell(labelText(label)+'<div style="font-size:17px;line-height:1.6;font-weight:700;color:#FFFFFF;overflow-wrap:break-word;word-break:break-word">'+esc(value)+'</div>');
const action = (href: string, name: string, bg: string, fg = "#FFFFFF") => '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse"><tr><td align="center" bgcolor="'+bg+'" style="background-color:'+bg+';border:1px solid #C5A059;border-radius:10px"><a href="'+href+'" style="display:block;padding:14px 10px;font-family:Arial,Tahoma,sans-serif;font-size:14px;line-height:1.4;font-weight:700;text-align:center;text-decoration:none;color:'+fg+'">'+name+'</a></td></tr></table>';
const gap = (height = 12) => '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td height="'+height+'" style="height:'+height+'px;font-size:0;line-height:0">&nbsp;</td></tr></table>';
export function renderAppointmentCard(input: AppointmentCard) {
  if (!input.clientName.trim() || !input.date.trim() || !input.location.trim()) throw new Error("Missing appointment details");
  if (input.status !== "confirmed") throw new Error("Only confirmed appointments can generate confirmations");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error("Client email required");
  if (input.documents.some(id => !DOCUMENTS.some(d => d.id === id))) throw new Error("Invalid document selection");
  const selected = [...new Set(input.documents)].map(id => DOCUMENTS.find(d => d.id === id)!);
  const name = titleCase(input.clientName);
  const section = (lang: "ar" | "en") => {
    const ar = lang === "ar";
    const heading = ar ? "تأكيد موعد المقابلة الوظيفية" : "Your Job Interview Is Confirmed";
    const greeting = ar ? "الأستاذ/ " + name : "Dear " + name + ",";
    const intro = ar
      ? "يسعدنا إبلاغكم بأنه تم تأكيد موعد المقابلة الوظيفية الخاصة بكم بنجاح. نرجو منكم الحضور إلى العنوان الموضح في الوقت المحدد، والاطّلاع على تفاصيل الموعد والمستندات المطلوبة أدناه لضمان سير إجراءاتكم بسلاسة."
      : "We are pleased to confirm your job interview appointment. Please arrive at the address below on time and review the appointment details and required documents to help everything go smoothly.";
    const closing = ar
      ? "إذا رغبتم في تعديل الموعد أو إلغائه، أو كانت لديكم أي استفسارات، يُرجى التواصل معنا، ويسعدنا مساعدتكم."
      : "If you need to reschedule or cancel your appointment, or have any questions, please contact us. We will be happy to assist you.";
    const labels = ar ? ["اسم المتقدم","تاريخ ووقت المقابلة","مكان المقابلة والعنوان","المستندات المطلوب إحضارها","بيانات التواصل","البريد الإلكتروني","رقم الهاتف"] : ["Applicant","Interview Date & Time","Interview Location & Address","Documents to Bring","Contact Details","Email","Phone"];
    const docs = selected.length ? selected.map(d=>cell('<span style="font-size:14px;line-height:1.7;color:#FFFFFF">✓ '+esc(d[lang])+'</span>',"11px 13px")).join(gap(8)) : '<p style="font-size:14px;color:#C9D4E4">'+(ar?"لم تُحدد مستندات إضافية لهذا الموعد.":"No additional documents specified.")+'</p>';
    const headingSmall = (value:string) => '<h2 style="font-size:16px;line-height:1.6;color:#E6BF79;font-weight:700;margin:22px 0 12px">'+value+'</h2>';
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" lang="'+lang+'" dir="'+(ar?"rtl":"ltr")+'" style="width:100%;border-collapse:collapse;direction:'+(ar?"rtl":"ltr")+'"><tr><td style="font-family:Arial,Tahoma,sans-serif;text-align:'+(ar?"right":"left")+';padding:4px 0">'
      +'<p style="margin:0 0 10px;color:#E6BF79;font-size:12px;font-weight:700">✓ '+(ar?"موعد مؤكد":"CONFIRMED APPOINTMENT")+'</p>'
      +'<h1 style="font-size:23px;line-height:1.5;color:#F4D6A2;margin:0 0 14px;font-weight:800">'+heading+'</h1>'
      +'<p style="font-size:17px;line-height:1.7;font-weight:700;color:#FFFFFF;margin:0 0 12px">'+esc(greeting)+'</p>'
      +'<p style="font-size:14px;line-height:1.9;color:#E2E8F0;margin:0 0 20px">'+intro+'</p>'
      +detail(labels[0],name)+gap()+detail(labels[1],input.date)+gap()+detail(labels[2],input.location)
      +headingSmall(labels[3])+docs+headingSmall(labels[4])+detail(labels[5],input.email)+gap()+detail(labels[6],input.phone)
      +'<p style="font-size:14px;line-height:1.9;color:#E2E8F0;margin:22px 0 0">'+closing+'</p>'
      +'</td></tr></table>';
  };
  const languages = input.language === "both" ? (["ar","en"] as const) : [input.language];
  const header = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:#0A122C"><tr><td align="center" style="padding:26px 16px;border-bottom:1px solid #C5A059;font-family:Arial,Tahoma,sans-serif">'
    +'<div style="font-size:28px;line-height:1.35;font-weight:800;letter-spacing:1px;color:#E6A64F">CAREER GATE</div>'
    +'<div lang="ar" dir="rtl" style="font-size:17px;line-height:1.7;font-weight:700;color:#FFFFFF">بوابة التوظيف</div>'
    +'<div style="font-size:10px;line-height:1.6;letter-spacing:1px;color:#C9D4E4">EXECUTIVE SMART GATE PASS</div></td></tr></table>';
  const footer = '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse"><tr><td style="padding:18px 16px 0">'
    +action("https://alhijrah-caseflow.vercel.app/status","متابعة حالة الملف / Track Status","#C5A059","#040914")
    +gap(10)+action("https://alhijrah-caseflow.vercel.app/status?appointment_action=confirm","تأكيد الموعد / Confirm Appointment","#173F43")
    +gap(10)+action("https://alhijrah-caseflow.vercel.app/status?appointment_action=reschedule","طلب تعديل الموعد / Reschedule","#183B64")
    +gap(10)+action("https://alhijrah-caseflow.vercel.app/status?appointment_action=cancel","إلغاء الموعد / Cancel","#44362A")
    +gap(10)+action("https://wa.me/13139194292","WhatsApp / واتساب","#173F43")
    +gap(10)+action("tel:+13133393566","Call / اتصال","#183B64")
    +gap(10)+action("mailto:careergate.official@gmail.com","Email / بريد","#44362A")
    +'<p style="font-size:12px;line-height:1.9;text-align:center;color:#C9D4E4;margin:24px 0 0" dir="rtl">مكتب الهجرة للاستشارات وخدمات التوظيف<br>Career Gate — بوابة التوظيف<br>ديربورن، ميشيغان — الولايات المتحدة الأمريكية</p>'
    +'<p style="font-size:11px;line-height:1.7;text-align:center;color:#9AAEC8;margin:8px 0 0">ALHIJRAH VISA &amp; IMMIGRATION SERVICES LLC · Dearborn, Michigan</p>'
    +'</td></tr></table>';
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Career Gate Appointment Confirmation</title></head>'
    +'<body style="margin:0;padding:0;background-color:#040914;color:#FFFFFF;font-family:Arial,Tahoma,sans-serif">'
    +'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#040914" style="width:100%;border-collapse:collapse;background-color:#040914"><tr><td align="center" style="padding:12px 8px">'
    +'<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;border:1px solid #C5A059;background-color:#0A122C;border-radius:16px">'
    +'<tr><td>'+header+'</td></tr>'
    +'<tr><td style="padding:22px 16px 8px">'+languages.map(section).join(gap(24)+'<hr style="border:0;border-top:1px solid #C5A059;margin:0">'+gap(24))+'</td></tr>'
    +'<tr><td style="padding:0 0 22px">'+footer+'</td></tr></table>'
    +'</td></tr></table></body></html>';
  const text = languages.map(lang => {
    const ar = lang === "ar";
    return [ar ? "بوابة التوظيف | تأكيد موعد مقابلة العمل" : "CAREER GATE | Job Interview Confirmation",
      ar ? "الأستاذ/ " + name : "Dear " + name + ",",
      ar ? "نُثمن اختياركم لبوابة التوظيف Career Gate، ويسعدنا تأكيد موعد المقابلة الوظيفية الخاصة بكم." : "Thank you for choosing Career Gate. Your job interview appointment is confirmed.",
      input.date,input.location,...selected.map(d => d[lang]),input.email,input.phone,
      "https://alhijrah-caseflow.vercel.app/status",
      ar ? "هذه التذكرة مخصصة لصاحب الموعد." : "This pass is intended for the named applicant."].join("\n");
  }).join("\n\n");
  return {subject: input.language === "en" ? "Career Gate | Job Interview Confirmation" : "Career Gate | تأكيد موعد مقابلة العمل",html,text};
}
