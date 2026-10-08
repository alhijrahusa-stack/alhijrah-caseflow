/**
 * The ten fields the client may review and correct on the public intake page.
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
] as const);

export type ClientEditableField = (typeof CLIENT_EDITABLE_FIELDS)[number];
