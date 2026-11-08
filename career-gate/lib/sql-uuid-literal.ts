declare const uuidLiteral: unique symbol;
export type SqlUuidLiteral = string & { readonly [uuidLiteral]: true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A PostgreSQL UUID literal for a read query whose only parameter is an ID.
 * The closed alphabet excludes quotes, escapes, comments and whitespace. Never
 * interpolate arbitrary text this way; other values remain bind parameters.
 */
export function sqlUuidLiteral(value: string): SqlUuidLiteral {
  if (typeof value !== "string" || !UUID.test(value)) throw new TypeError("Invalid UUID read identity");
  return `'${value.toLowerCase()}'::uuid` as SqlUuidLiteral;
}
