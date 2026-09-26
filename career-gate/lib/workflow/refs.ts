import { randomInt } from "node:crypto";

// No 0/O/1/I/L so refs survive being read aloud or typed from a phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newRef(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `CG-${out}`;
}

/** Digits only, with a leading US country code, as the WhatsApp API expects. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return null;
}
