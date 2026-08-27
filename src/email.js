const htmlEscape = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const token = (text, values) => String(text || '').replace(/\{([A-Za-z_]+)\}/g, (match, key) => values[key] ?? match);

export function normalizeLanguage(value, fallback = 'English') {
  return /^(arabic|ar|العربية)$/i.test(String(value || '')) ? 'Arabic' : /^(english|en)$/i.test(String(value || '')) ? 'English' : fallback;
}

export function renderCaseOpeningEmail({ settings, template, client, caseRecord, portalLink, logoUrl }) {
  const language = normalizeLanguage(client.preferred_language, settings.default_language || 'English');
  const arabic = language === 'Arabic';
  const values = {
    Client_Name: client.legal_name,
    Client_Number: client.client_number,
    Case_Number: caseRecord.case_number,
    Service_Name: caseRecord.case_type,
    Portal_Link: portalLink,
  };
  const subject = token(arabic ? template.subject_ar : template.subject_en, values);
  const introduction = token(arabic ? template.body_ar : template.body_en, values);
  const labels = arabic
    ? { client: 'اسم العميل', clientNumber: 'رقم العميل', caseNumber: 'رقم الملف', service: 'الخدمة', opened: 'تاريخ فتح الملف', portal: 'فتح البوابة الآمنة', contact: 'بيانات التواصل' }
    : { client: 'Client', clientNumber: 'Client Number', caseNumber: 'Case Number', service: 'Service', opened: 'Opening Date', portal: 'Open Secure Portal', contact: 'Office Contact' };
  const direction = arabic ? 'rtl' : 'ltr';
  const footer = arabic ? settings.email_footer_ar : settings.email_footer_en;
  const contact = [settings.office_email, settings.office_phone, settings.office_whatsapp].filter(Boolean).join(' · ');
  const details = [
    [labels.client, client.legal_name],
    [labels.clientNumber, client.client_number],
    [labels.caseNumber, caseRecord.case_number],
    [labels.service, caseRecord.case_type],
    [labels.opened, caseRecord.opened_on || String(caseRecord.created_at || '').slice(0, 10)],
  ];
  const html = `<!doctype html><html dir="${direction}" lang="${arabic ? 'ar' : 'en'}"><head><meta charset="utf-8"></head><body style="margin:0;background:#edf1f5;font-family:Arial,'Noto Sans Arabic',sans-serif;color:#102033"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf1f5;padding:28px 12px"><tr><td align="center"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #d9e0e8;border-radius:14px;overflow:hidden"><tr><td style="background:#071a2f;padding:26px 32px;border-bottom:4px solid #b99345"><table role="presentation" width="100%"><tr><td>${logoUrl ? `<img src="${htmlEscape(logoUrl)}" alt="${htmlEscape(settings.office_name)}" width="58" height="58" style="display:block;object-fit:contain;background:#fff;border-radius:10px">` : '<div style="width:54px;height:54px;line-height:54px;text-align:center;border:1px solid #d7b76b;border-radius:10px;color:#d7b76b;font-size:28px;font-weight:bold">A</div>'}</td><td style="color:#fff;font-size:20px;font-weight:bold;${arabic ? 'text-align:left' : 'text-align:right'}">${htmlEscape(settings.office_name || 'ALHIJRAH SERVICES')}</td></tr></table></td></tr><tr><td style="padding:34px 32px"><h1 style="margin:0 0 14px;font-size:25px;color:#071a2f">${htmlEscape(subject)}</h1><p style="margin:0 0 24px;line-height:1.8;color:#4b5d70">${htmlEscape(introduction)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e0e6ed;border-radius:10px;overflow:hidden">${details.map(([label, value]) => `<tr><td style="padding:12px 16px;background:#f7f9fb;border-bottom:1px solid #e8edf2;color:#5c6b7a;width:42%">${htmlEscape(label)}</td><td style="padding:12px 16px;border-bottom:1px solid #e8edf2;font-weight:bold">${htmlEscape(value || '—')}</td></tr>`).join('')}</table><p style="margin:28px 0;text-align:center"><a href="${htmlEscape(portalLink)}" style="display:inline-block;background:#b99345;color:#071a2f;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:8px">${htmlEscape(labels.portal)}</a></p>${contact ? `<p style="margin:0;color:#657588;font-size:13px"><b>${htmlEscape(labels.contact)}:</b> ${htmlEscape(contact)}</p>` : ''}${footer ? `<p style="margin:18px 0 0;color:#657588;font-size:13px;line-height:1.7">${htmlEscape(footer)}</p>` : ''}</td></tr></table></td></tr></table></body></html>`;
  const text = `${subject}\n\n${introduction}\n\n${details.map(([label, value]) => `${label}: ${value || '—'}`).join('\n')}\n\n${labels.portal}: ${portalLink}${contact ? `\n${labels.contact}: ${contact}` : ''}${footer ? `\n\n${footer}` : ''}`;
  return { language, subject, html, text };
}

export async function sendTransactionalEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw Object.assign(new Error('EMAIL_PROVIDER_NOT_CONFIGURED'), { code: 'EMAIL_PROVIDER_NOT_CONFIGURED' });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html, text }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.id) throw Object.assign(new Error('EMAIL_DELIVERY_FAILED'), { code: `RESEND_${response.status}` });
  return { provider: 'resend', messageId: payload.id };
}
