/**
 * The client-editable fields the client may review and correct on the public intake page.
 *
 * This list is shared by the browser and the server. It lives apart from
 * `lib/client-intake-link.ts`, which is server-only, so the client page can
 * import the field list without pulling the database layer into its bundle.
 */
export const CLIENT_EDITABLE_FIELDS = Object.freeze([
  "full_name",
  "phone",
  "email",
  "date_of_birth",
  "street",
  "city",
  "state",
  "zip",
  "preferred_language",
  "english_proficiency",
  "site_code",
  "alt_site_code",
  "backup_site_code",
  "shift_code",
  "shift_days",
  "shift_start_time",
  "shift_end_time",
  "additional_notes",
] as const);

export type ClientEditableField = (typeof CLIENT_EDITABLE_FIELDS)[number];

/**
 * The maximum length accepted for each client-editable field, shared by the browser
 * and the server so the limit the client types against is the limit that is stored.
 * A short canonical value keeps the short cap; a free-prose note gets a prose cap,
 * so a client's note is never silently truncated at a field-sized limit.
 */
export const CLIENT_EDIT_MAX_LENGTH = 200;
export const CLIENT_NOTE_MAX_LENGTH = 2000;

export function clientEditMaxLength(field: ClientEditableField) {
  return field === "additional_notes" ? CLIENT_NOTE_MAX_LENGTH : CLIENT_EDIT_MAX_LENGTH;
}
