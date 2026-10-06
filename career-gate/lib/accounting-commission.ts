import "server-only";

/**
 * LOCKED BUSINESS RULE — COMMISSION_OWNER = APPLICATION_COMPLETED_BY
 *
 * The commission for a paid client account belongs to the employee recorded as
 * having completed that client's application, and to no one else. It is never
 * derived from:
 *
 *   • the staff member currently assigned to the client (`clients.assigned_staff`)
 *   • the staff member who recorded the payment (`payment_transactions.recorded_by`)
 *   • the staff member who uploaded the receipt
 *   • the staff member operating the Accounting screen (the session)
 *   • the staff member who last edited the client
 *
 * Ownership therefore does not move when a client is reassigned, when a
 * different person records the money, or when anyone else edits the file. If no
 * completion has been recorded, there is no owner and no commission is created —
 * the account reports why rather than attributing the money to a stand-in.
 */
export const COMMISSION_OWNER_FIELD = "application_completed_by" as const;

/** Why an otherwise payable account produced no commission. */
export type CommissionBlockReason = "APPLICATION_NOT_COMPLETED" | "NO_ACTIVE_COMMISSION_RULE";

/**
 * Resolves the commission owner for a client. The sole input is the recorded
 * application completion; every other candidate is deliberately not a parameter
 * of this function, so no future caller can pass one in.
 */
export function resolveCommissionOwner(client: { application_completed_by?: string | null } | null | undefined):
  { employeeId: string } | { employeeId: null; reason: CommissionBlockReason } {
  const owner = client?.application_completed_by ?? null;
  if (!owner) return { employeeId: null, reason: "APPLICATION_NOT_COMPLETED" };
  return { employeeId: owner };
}

/**
 * Commission amount from the account's net fee — what the client actually owes
 * after any discount — and the versioned rule in force.
 */
export function commissionAmount(rule: { commission_type: string; commission_value: unknown }, netFee: number) {
  return rule.commission_type === "percent"
    ? Math.round(Number(netFee) * Number(rule.commission_value)) / 100
    : Number(rule.commission_value);
}
