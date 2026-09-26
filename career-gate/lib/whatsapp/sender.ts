import "server-only";

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string; retryable: boolean };

/**
 * Sends an approved WhatsApp template message through the Cloud API.
 * Template names must match templates approved in the Meta Business account.
 */
export async function sendTemplate(
  to: string,
  template: string,
  params: string[],
): Promise<SendResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION;
  if (!token || !phoneId || !version) {
    return { ok: false, error: "WhatsApp is not configured", retryable: false };
  }

  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en_US" },
        components: params.length
          ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
          : [],
      },
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[];
    error?: { message?: string };
  };
  if (!res.ok) {
    return {
      ok: false,
      error: body.error?.message ?? `HTTP ${res.status}`,
      retryable: res.status === 429 || res.status >= 500,
    };
  }
  return { ok: true, messageId: body.messages?.[0]?.id ?? null };
}
