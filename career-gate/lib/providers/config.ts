// Central provider/model registry. Model IDs live here and in env only.
export type ProviderState = "CONFIGURED" | "NOT_CONFIGURED";

const env = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : null;
};

export const registry = {
  supabase: () => ({
    url: env("NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
    jwtSecret: env("SUPABASE_JWT_SECRET"),
  }),
  documentVision: () => ({
    apiKey: env("GOOGLE_GEMINI_API_KEY"),
    fastModel: env("DOCUMENT_VISION_FAST_MODEL"),
    escalationModel: env("DOCUMENT_VISION_ESCALATION_MODEL"),
  }),
  regula: () => ({
    url: env("REGULA_DOCUMENT_READER_URL"),
    authorization: env("REGULA_DOCUMENT_READER_AUTHORIZATION"),
    version: "9.9",
  }),
  microblink: () => ({
    url: env("MICROBLINK_VERIFY_URL"),
    authorization: env("MICROBLINK_VERIFY_AUTHORIZATION"),
    mode: env("MICROBLINK_VERIFY_MODE") === "cloud" ? ("cloud" as const) : ("self_hosted" as const),
    version: "4000.4.0",
  }),
  openai: () => ({
    apiKey: env("OPENAI_API_KEY"),
    agentModel: env("OPENAI_AGENT_MODEL"),
    embeddingModel: env("OPENAI_EMBEDDING_MODEL"),
    embeddingDimensions: Number(env("EMBEDDING_DIMENSIONS") ?? "0"),
  }),
  whatsapp: () => ({
    token: env("WHATSAPP_TOKEN"),
    phoneId: env("WHATSAPP_PHONE_ID"),
    businessAccountId: env("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    apiVersion: env("WHATSAPP_API_VERSION"),
    appSecret: env("WHATSAPP_APP_SECRET"),
    verifyToken: env("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
    templateSubmission: env("WHATSAPP_TEMPLATE_SUBMISSION"),
    templateOtp: env("WHATSAPP_TEMPLATE_STATUS_OTP"),
    templateLang: env("WHATSAPP_TEMPLATE_LANG"),
  }),
  twilio: () => ({
    sid: env("TWILIO_ACCOUNT_SID"),
    token: env("TWILIO_AUTH_TOKEN"),
    from: env("TWILIO_PHONE_NUMBER"),
  }),
  resend: () => ({ apiKey: env("RESEND_API_KEY"), from: env("RESEND_FROM_EMAIL"), webhookSecret: env("RESEND_WEBHOOK_SECRET") }),
  app: () => ({ baseUrl: env("APP_BASE_URL"), adminEmail: env("CAREER_GATE_ADMIN_EMAIL"), cronSecret: env("CRON_SECRET") }),
};

/** Only 1536-dimension embeddings fit the semantic_index column. */
export const EMBEDDING_COLUMN_DIMENSIONS = 1536;

export function providerStates() {
  const s = registry.supabase();
  const v = registry.documentVision();
  const rg = registry.regula();
  const mb = registry.microblink();
  const o = registry.openai();
  const w = registry.whatsapp();
  const t = registry.twilio();
  const r = registry.resend();
  const st = (ok: boolean): ProviderState => (ok ? "CONFIGURED" : "NOT_CONFIGURED");
  return {
    supabase_auth: st(Boolean(s.url && s.anonKey && (s.jwtSecret || s.url))),
    supabase_storage: st(Boolean(s.url && s.serviceKey)),
    realtime: st(Boolean(s.url && s.anonKey)),
    document_vision_fast: st(Boolean(v.apiKey && v.fastModel)),
    document_vision_escalation: st(Boolean(v.apiKey && v.escalationModel)),
    regula_document_reader: st(Boolean(rg.url)),
    microblink_verify: st(Boolean(mb.url && (mb.mode === "self_hosted" || mb.authorization))),
    agent_llm: st(Boolean(o.apiKey && o.agentModel)),
    embeddings: st(Boolean(o.apiKey && o.embeddingModel && o.embeddingDimensions === EMBEDDING_COLUMN_DIMENSIONS)),
    whatsapp_meta: st(Boolean(w.token && w.phoneId && w.apiVersion && w.templateLang)),
    sms_twilio: st(Boolean(t.sid && t.token && t.from)),
    email_resend: st(Boolean(r.apiKey && r.from)),
  };
}
