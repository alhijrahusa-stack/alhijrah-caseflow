/** Log only a bounded provider error code, never request text, audio or credentials. */
export function providerErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("error" in error)) return undefined;
  const body: unknown = error.error;
  if (!body || typeof body !== "object") return undefined;
  const detail: unknown = "code" in body ? body : "error" in body ? body.error : null;
  if (!detail || typeof detail !== "object" || !("code" in detail)) return undefined;
  const code: unknown = detail.code;
  return typeof code === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(code) ? code : undefined;
}
