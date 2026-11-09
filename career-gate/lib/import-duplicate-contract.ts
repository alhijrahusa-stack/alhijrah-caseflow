import { z } from "zod";

export const IMPORT_REVIEW_REASONS = [
  { id: "exact_duplicate", en: "Name and phone match", ar: "تطابق الاسم ورقم الهاتف" },
  { id: "possible_duplicate", en: "Partial match needs a decision", ar: "تطابق جزئي يحتاج قرارًا" },
  { id: "manager_review", en: "Manager review required", ar: "يتطلب مراجعة المدير" },
  { id: "incorrect_record", en: "Review an incorrect record", ar: "مراجعة سجل غير صحيح" },
] as const;
export type ImportReviewReason = typeof IMPORT_REVIEW_REASONS[number]["id"];
export type ImportIdentity = {
  kind: "import" | "client"; id: string; ref: string; full_name: string; phone: string;
  location: string; status: string; version: string; held: boolean; href: string;
};
export type ImportMatch = ImportIdentity & { name_match: boolean; phone_match: boolean; level: "exact" | "partial" };
export type ImportComparison = {
  source: ImportIdentity; matches: ImportMatch[]; selected_target?: ImportMatch | null;
  level: "exact" | "partial" | "none" | "insufficient";
  checked_at: string; fingerprint: string; match_count: number; exact_count: number; partial_count: number;
  reason_code?: ImportReviewReason;
};
export type ImportReviewQueue = { rows: ImportIdentity[]; total: number; page: number; page_size: number };
export const ImportReviewSubmission = z.object({
  action: z.literal("submit"), case_id: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  reason: z.enum(["exact_duplicate", "possible_duplicate", "manager_review", "incorrect_record"]),
  target_kind: z.enum(["import", "client"]).optional(), target_id: z.uuid().optional(), operation_id: z.uuid(),
}).refine(input => Boolean(input.target_kind) === Boolean(input.target_id), "Choose a valid comparison record");
export const ImportReviewRequest = z.discriminatedUnion("action", [ImportReviewSubmission,
  z.object({ action: z.literal("restore"), case_id: z.uuid(), operation_id: z.uuid() }),
]);
