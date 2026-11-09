/** Shared, non-sensitive presence metadata. Presence never grants file ownership. */
import { CLIENT_STAGES, isClientStageFilter, type ClientStageFilter } from "@/lib/client-lifecycle-filters";
import { parseRegistryFilters } from "@/lib/registry-filters";

export const PRESENCE_IDLE_MS = 5 * 60 * 1000;
export const PRESENCE_STALE_MS = 90 * 1000;
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;
export const PRESENCE_MIN_PUBLISH_MS = 2 * 1000;
const STAFF_PATH = /^\/staff(?:\/[A-Za-z0-9_-]+)*\/?$/;
const CLIENT_PATH = /^\/staff\/client\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export type StaffPresenceState = "active" | "idle";
export type PresenceWorkspaceSection = ClientStageFilter | "all" | "payment_paperwork";
export type StaffPresencePacket = {
  tab_id: string;
  path: string;
  active_client_id: string | null;
  workspace_section: PresenceWorkspaceSection | null;
  state: StaffPresenceState;
  visible: boolean;
  observed_at: number;
};
export type TeamPresenceMember = {
  staff_id: string;
  auth_user_id: string;
  display_name: string;
  avatar_url?: string | null;
  path: string | null;
  workspace_section: PresenceWorkspaceSection | null;
  active_client_id: string | null;
  active_client_name: string | null;
  active_client_ref: string | null;
  state: StaffPresenceState | null;
  visible: boolean | null;
  seen_at: string | null;
};
export type TeamPresenceClient = { id: string; ref: string; full_name: string };

export function safeStaffPresencePath(path: unknown): string | null {
  return typeof path === "string" && path.length <= 300 && STAFF_PATH.test(path) ? path.replace(/\/$/, "") : null;
}
export function clientIdForPresencePath(path: string): string | null {
  return CLIENT_PATH.exec(path)?.[1]?.toLowerCase() ?? null;
}
export function isPresenceWorkspaceSection(value: unknown): value is PresenceWorkspaceSection {
  return value === "all" || value === "payment_paperwork" || isClientStageFilter(value);
}
export function presenceWorkspaceSection(path: string, params: URLSearchParams): PresenceWorkspaceSection | null {
  if (path !== "/staff/clients") return null;
  const filters = parseRegistryFilters(params, true);
  return filters.urgent ? "urgent" : filters.group === "paperwork" ? "payment_paperwork" : filters.stage ?? (filters.view === "completed" ? "completed" : filters.view === "all" ? "all" : null);
}
export function presenceHref(path: string | null, workspaceSection?: PresenceWorkspaceSection | null): string | null {
  const safePath = safeStaffPresencePath(path);
  if (safePath !== "/staff/clients" || !workspaceSection || !isPresenceWorkspaceSection(workspaceSection)) return safePath;
  if(workspaceSection === "urgent") return `${safePath}?urgent=1`;
  if(workspaceSection === "payment_paperwork") return `${safePath}?group=paperwork`;
  return `${safePath}?${workspaceSection === "all" || workspaceSection === "completed" ? "view" : "stage"}=${workspaceSection}`;
}
export function presenceSection(path: string | null, workspaceSection?: PresenceWorkspaceSection | null): { en: string; ar: string } {
  if (path === "/staff/clients" && workspaceSection) {
    if (workspaceSection === "urgent") return {en:"Urgent priority view",ar:"عرض ملفات الأولوية"};
    if (workspaceSection === "payment_paperwork") return {en:"Payment & Paperwork",ar:"الدفع واستكمال الوثائق"};
    if (workspaceSection === "all") return { en: "All client records", ar: "جميع سجلات العملاء" };
    const stage = CLIENT_STAGES.find(candidate => candidate.id === workspaceSection);
    if (stage) return { en: `Clients · ${stage.label}`, ar: `العملاء · ${stage.labelAr}` };
  }
  const section = path?.split("/")[2] ?? "";
  const sections: Record<string, [string, string]> = {
    "": ["Dashboard", "لوحة القيادة"], client: ["Client file", "ملف العميل"], clients: ["Clients", "العملاء"],
    appointments: ["Appointments", "المواعيد"], import: ["Smart Client", "Smart Client"],
    "smart-client-import": ["Smart Client", "Smart Client"], "manager-inbox": ["Manager's Task Center", "مركز مهام المدير"],
    "worksite-changes": ["Worksite Changes · Salah Almoraisy", "تغيير موقع العمل · قسم صلاح المريسي"],
    accounting: ["Accounting", "المحاسبة"], documents: ["Documents", "الوثائق"], tasks: ["Tasks", "المهام"],
    "follow-ups": ["Follow-ups", "المتابعات"], staff: ["Team", "الفريق"], reports: ["Reports", "التقارير"],
    archive: ["Deleted files", "المحذوفات"], pipeline: ["Workflow", "مسار العمل"], settings: ["Settings", "الإعدادات"],
    "gate-job-account": ["Amazon accounts", "حسابات Amazon"], "new-client": ["New client", "عميل جديد"],
    today: ["Today's work", "عمل اليوم"], week: ["This week", "هذا الأسبوع"], distribution: ["Assignments", "التوزيع"],
    "audit-alerts": ["Audit alerts", "تنبيهات المراجعة"],
  };
  const label = sections[section] ?? ["Staff workspace", "مساحة الموظف"];
  return { en: label[0], ar: label[1] };
}

export function parsePresencePacket(value: unknown): StaffPresencePacket | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const path = safeStaffPresencePath(data.path);
  if (!path || typeof data.tab_id !== "string" || !/^[\w-]{8,100}$/.test(data.tab_id)
    || !["active", "idle"].includes(String(data.state)) || typeof data.visible !== "boolean"
    || typeof data.observed_at !== "number" || !Number.isFinite(data.observed_at)) return null;
  // The linked client is derived from the safe route, never a separate supplied identifier.
  return { tab_id: data.tab_id, path, active_client_id: clientIdForPresencePath(path), state: data.state as StaffPresenceState,
    workspace_section: path === "/staff/clients" && isPresenceWorkspaceSection(data.workspace_section) ? data.workspace_section : null,
    visible: data.visible, observed_at: data.observed_at };
}

/** One employee row, even when several tabs are connected. */
export function selectCurrentPresence(packets: readonly StaffPresencePacket[], now = Date.now()): StaffPresencePacket | null {
  const current = packets.filter(packet => packet.observed_at <= now + 30_000 && now - packet.observed_at <= PRESENCE_STALE_MS);
  return [...current].sort((a, b) => Number(b.visible) - Number(a.visible)
    || Number(b.state === "active") - Number(a.state === "active") || b.observed_at - a.observed_at)[0] ?? null;
}
