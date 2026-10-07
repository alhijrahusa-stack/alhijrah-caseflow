/**
 * Display and preview helpers for financial figures.
 *
 * Nothing here is authoritative. The server and the database decide every
 * amount that is stored or compared — the discount, the net fee, each
 * transaction's effect, the balance and the commission. These functions exist to
 * render a figure the server already produced, and to show the operator what a
 * discount would come to before they commit it. A preview is labelled as one
 * wherever it appears, and is never sent back as the value to store.
 */

/** The currency precision the server and database contract uses. */
export const CURRENCY_PRECISION = 2;

export function formatMoney(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "—";
  return `$${numeric.toFixed(CURRENCY_PRECISION)}`;
}

export function formatPercent(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric)) return "—";
  // Trailing zeros are dropped so 20 reads as 20%, not 20.0000%.
  return `${Number(numeric.toFixed(4))}%`;
}

/**
 * What a discount would come to, for the operator to check before committing.
 * The server recomputes it from the fee it holds; this result is never stored.
 */
export function previewDiscount(type: "amount" | "percentage", value: number, feeAmount: number) {
  if (!Number.isFinite(value) || value < 0) return null;
  if (type === "percentage") {
    if (value > 100) return null;
    return Math.round(feeAmount * value) / 100;
  }
  return Math.round(value * 100) / 100;
}

/** A parsed numeric input, or null when the field does not hold a number. */
export function parseAmount(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

const TRANSACTION_LABEL: Record<string, string> = {
  payment: "Payment",
  refund: "Refund",
  adjustment: "Adjustment",
  waiver: "Waiver",
};

export const transactionLabel = (type: string) => TRANSACTION_LABEL[type] ?? type;

const METHOD_LABEL: Record<string, string> = {
  zelle: "Zelle",
  bank_transfer: "Bank Transfer",
  cash: "Cash",
  card: "Card",
  other: "Other",
};

export const methodLabel = (method: string | null) => (method ? METHOD_LABEL[method] ?? method : "—");

export const PAYMENT_METHODS = ["zelle", "bank_transfer", "cash", "card", "other"] as const;

/** Today in the business timezone, so a recorded date matches the ledger's day. */
export function businessToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts;
}
