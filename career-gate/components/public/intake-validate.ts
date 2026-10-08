import type { ClientEditableField } from "@/lib/client-intake-fields";
import type { IntakeStrings } from "@/components/public/intake-copy";

/**
 * Inline validation for the fields the client can correct.
 *
 * It only ever rejects a value that is present and plainly wrong — nothing here
 * is required, because the staff review that follows is where completeness is
 * decided. The message is exact and contextual, never a generic form error.
 */
export function validateIntakeField(field: ClientEditableField, raw: string, t: IntakeStrings): string | null {
  const value = raw.trim();
  if (!value) return null;
  switch (field) {
    case "phone":
      return value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").length === 10 ? null : t.invalidPhone;
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? null : t.invalidEmail;
    case "zip":
      return /^\d{5}(-\d{4})?$/.test(value) ? null : t.invalidZip;
    case "date_of_birth":
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? null : t.invalidDate;
    default:
      return null;
  }
}

/** The input mode and autocomplete hint each field should offer on a phone. */
export const FIELD_INPUT: Record<ClientEditableField, { type?: string; inputMode?: "text" | "tel" | "email" | "numeric"; autoComplete?: string }> = {
  full_name: { autoComplete: "name" },
  phone: { type: "tel", inputMode: "tel", autoComplete: "tel-national" },
  email: { type: "email", inputMode: "email", autoComplete: "email" },
  date_of_birth: { type: "date", autoComplete: "bday" },
  street: { autoComplete: "street-address" },
  city: { autoComplete: "address-level2" },
  state: { autoComplete: "address-level1" },
  zip: { inputMode: "numeric", autoComplete: "postal-code" },
  preferred_language: { autoComplete: "language" },
  english_proficiency: {},
};

/** The groups the review fields are presented in, so the list reads as a form. */
export const FIELD_GROUPS: readonly { key: "identity" | "contact" | "address" | "language"; fields: readonly ClientEditableField[] }[] = [
  { key: "identity", fields: ["full_name", "date_of_birth"] },
  { key: "contact", fields: ["phone", "email"] },
  { key: "address", fields: ["street", "city", "state", "zip"] },
  { key: "language", fields: ["preferred_language", "english_proficiency"] },
] as const;
