import { isClientStageFilter } from "@/lib/client-lifecycle-filters";
import { STATUSES } from "@/lib/domain";

export const REGISTRY_PAGE_SIZE = 10;
export const REGISTRY_EXPORT_LIMIT = 1000;
export const REGISTRY_FILTER_KEYS = ["view", "stage", "status", "assigned", "attention", "completed_this_month", "q"] as const;
export type RegistryFilters = Partial<Record<(typeof REGISTRY_FILTER_KEYS)[number], string>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared by the registry, saved filters and export: no surface can widen a stage implicitly. */
export function parseRegistryFilters(params: URLSearchParams, management: boolean) {
  const requested = params.get("view");
  const status = (STATUSES as readonly string[]).includes(params.get("status") ?? "") ? params.get("status")! : undefined;
  const assignedValue = params.get("assigned");
  const assigned = management && (assignedValue === "none" || UUID.test(assignedValue ?? "")) ? assignedValue! : undefined;
  const attention = params.get("attention") === "documents" ? "documents" as const : undefined;
  const stageValue = params.get("stage");
  const stage = isClientStageFilter(stageValue) ? stageValue :
    !requested && !status && !attention && !assigned ? "new_intake" : undefined;
  const view = stage === "completed" ? "completed" : (stage || attention || assigned === "none") ? "active" :
    requested === "all" || requested === "completed" ? requested : "active";
  const rawPage = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  return { view, page, q: params.get("q")?.trim().slice(0, 100) || undefined, status,
    stage: isClientStageFilter(stage) ? stage : undefined, assigned, attention,
    completedThisMonth: params.get("completed_this_month") === "1" } as const;
}

export function registryFilterValues(params: URLSearchParams, management: boolean): RegistryFilters {
  const parsed = parseRegistryFilters(params, management);
  return Object.fromEntries(Object.entries({ view: parsed.view, stage: parsed.stage, status: parsed.status,
    assigned: parsed.assigned, attention: parsed.attention, completed_this_month: parsed.completedThisMonth ? "1" : undefined,
    q: parsed.q }).filter(([,value]) => value !== undefined));
}

export function normalizeRegistrySearch(value: string) {
  return value.toLowerCase().replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, "");
}

/** Keep original text boundaries when Arabic diacritics are removed for highlighting. */
export function registryHighlightParts(value: string, query: string): { text: string; match: boolean }[] {
  const term = normalizeRegistrySearch(query.trim());
  if (!term) return [{ text: value, match: false }];
  let normalized = "";
  const offsets: number[] = [];
  let offset = 0;
  for (const char of value) {
    const clean = normalizeRegistrySearch(char);
    for (let i = 0; i < clean.length; i++) offsets.push(offset);
    normalized += clean;
    offset += char.length;
  }
  const parts: {text:string;match:boolean}[] = [];
  let start = 0;
  let found = normalized.indexOf(term);
  while (found >= 0) {
    const from = offsets[found];
    const next = found + term.length;
    const to = next < offsets.length ? offsets[next] : value.length;
    if (from > start) parts.push({ text: value.slice(start, from), match: false });
    parts.push({ text: value.slice(from, to), match: true });
    start = to;
    found = normalized.indexOf(term, next);
  }
  if (start < value.length || !parts.length) parts.push({ text: value.slice(start), match: false });
  return parts;
}

export function registryPageNumbers(page: number, pages: number) {
  return [...new Set([1, page - 1, page, page + 1, pages].filter(n => n >= 1 && n <= pages))].sort((a,b) => a-b);
}
