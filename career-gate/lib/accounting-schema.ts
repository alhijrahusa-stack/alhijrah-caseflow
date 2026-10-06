import "server-only";

/**
 * Deployment-ordering tolerance for migration 033.
 *
 * Career Gate migrations are applied to Supabase by hand (career-gate/README.md);
 * no pipeline applies them, so the code can reach production before the schema
 * does. That is how `column "english_proficiency" of relation "clients" does not
 * exist` reached production once already, and there it took down the write path.
 *
 * These fragments read the columns migration 033 adds through a dynamic key
 * lookup on the row, which parses against either schema and yields NULL when the
 * column is absent. Read surfaces therefore degrade to exactly their pre-033
 * behaviour — the contracted fee, no discount, no recorded completion — instead
 * of failing the page.
 *
 * Writes are deliberately NOT tolerant. `recordApplicationCompletion` and
 * `applyAccountDiscount` address the new columns directly, so attempting either
 * before the migration fails loudly and says which migration is missing. Nothing
 * is silently discarded and no commission is attributed on a guess: with no
 * readable completion the owner is absent and no commission is created.
 *
 * Once 033 is applied everywhere, these fragments can be replaced by plain
 * column references.
 */

/** `client_accounts` discount, 0 before migration 033. */
export const DISCOUNT_AMOUNT = (alias: string) =>
  `coalesce((to_jsonb(${alias})->>'discount_amount')::numeric,0)`;

/** `client_accounts` net fee: the contracted fee before migration 033. */
export const ACCOUNT_NET_FEE = (alias: string) =>
  `(${alias}.fee_amount - ${DISCOUNT_AMOUNT(alias)})::numeric(10,2)`;

/** `client_account_balances` net fee: the view's gross fee before migration 033. */
export const BALANCE_NET_FEE = (alias: string) =>
  `coalesce((to_jsonb(${alias})->>'net_fee')::numeric,${alias}.fee_amount)::numeric(10,2)`;

/** A column added by migration 033, read off an already-serialized row. */
export const JSON_FIELD = (jsonExpr: string, column: string) => `(${jsonExpr}->>'${column}')`;

/** A `clients` column added by migration 033, NULL before it. */
export const CLIENT_FIELD = (alias: string, column: string) => JSON_FIELD(`to_jsonb(${alias})`, column);

/** The Postgres error a strict write raises when migration 033 is not applied. */
export function missingAccountingSchema(message: string) {
  return /column .*(application_status|application_completed_by|application_completed_at|discount_amount|discount_reason|discount_updated_by|discount_updated_at).* does not exist/i.test(message);
}
