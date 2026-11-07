import type { ManagerInboxItem, ManagerInboxPage, ManagerSummary } from "@/lib/manager-inbox";

export type ManagerReviewItem = ManagerInboxItem & { destination?: string | null };
export type ManagerInbox = ManagerInboxPage;
export type ManagerKPIStats = ManagerSummary;
export type ManagerSegment = "action" | "urgent" | "payments" | "resolved";
export type ManagerFilters = {
  status: "open" | "resolved";
  kind: string;
  request_type: string;
  urgent: string;
  payments: string;
  sender: string;
  q: string;
  sort: string;
};
