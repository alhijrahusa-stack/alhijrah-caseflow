import { G3_STAGES } from "@/lib/g3-stages";

export type AssistantIntent = "unpaid_interviews" | "team_load" | "document_blockers" | "flow_forecast" | "help";

/** Narrow, transparent intent matching: this assistant answers operational data questions, not invented AI output. */
export function assistantIntent(question: string): AssistantIntent {
  const text = question.normalize("NFKC").toLowerCase().replace(/[\u064b-\u065f\u0670]/g, "").replace(/[أإآ]/g, "ا");
  if (/(pay|paid|revenue|balance|unpaid|payment|دفع|يدفع|يسدد|سداد|مستحق|رسوم|مالي)/.test(text)) return "unpaid_interviews";
  if (/(team|staff|workload|specialist|assign|فريق|موظف|ضغط|اسناد|توزيع|حمل)/.test(text)) return "team_load";
  if (/(document|paper|passport|missing|وثيق|وثائق|جواز|نواقص|ناقص)/.test(text)) return "document_blockers";
  if (/(forecast|predict|bottleneck|pipeline|throughput|flow|delay|متاخر|تاخر|توقع|اختناق|مسار|وتير)/.test(text)) return "flow_forecast";
  return "help";
}

export type FlowForecast = {
  stage: string;
  label: string;
  labelAr: string;
  href: string;
  queued: number;
  exits_28d: number;
  exits_7d: number;
  estimated_clearance_days: number | null;
  beyond_week_capacity: number | null;
  sample: "sufficient" | "insufficient";
};

/** Baseline capacity projection only. No due dates or statistical confidence are inferred from a queue count. */
export function projectFlow(rows: readonly { stage: string; queued: number; exits_28d: number; exits_7d: number }[]): FlowForecast[] {
  return G3_STAGES.filter((stage) => stage.id !== "registry").map((stage) => {
    const raw = rows.find((row) => row.stage === stage.id);
    const count = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
    const queued = count(raw?.queued);
    const exits = count(raw?.exits_28d);
    const recent = count(raw?.exits_7d);
    const sufficient = exits >= 5;
    return {
      stage: stage.id, label: stage.label, labelAr: stage.labelAr, href: stage.href,
      queued, exits_28d: exits, exits_7d: recent,
      estimated_clearance_days: sufficient ? Math.ceil(queued / (exits / 28)) : null,
      beyond_week_capacity: sufficient ? Math.max(0, queued - Math.floor(exits / 4)) : null,
      sample: sufficient ? "sufficient" : "insufficient",
    };
  });
}
