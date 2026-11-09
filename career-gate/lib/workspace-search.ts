/** URL rules shared by the header and command palette. Search never changes a
 * file's operational location; it only selects an authorized view. */
export type WorkspaceSearchScope = "current" | "all";
export const REGISTRY_QUERY_EVENT = "career-gate:registry-query";

export type WorkspaceSearchDraft = {
  base: string; path: string; value: string; scope: WorkspaceSearchScope;
  navigating: boolean; searchHrefs: string[];
};

/** Ignore query-string ordering when matching an actual Header search response. */
export function workspaceSearchNavigationKey(href: string) {
  const url = new URL(href, "https://career-gate.invalid");
  url.searchParams.sort();
  return `${url.pathname}${url.searchParams.size ? `?${url.searchParams}` : ""}`;
}

/** Only a recorded Header response may retain text typed after that request.
 * Sidebar, saved-filter and history navigation instead restore their own query. */
export function reconcileWorkspaceSearchNavigation(draft: WorkspaceSearchDraft, href: string): WorkspaceSearchDraft {
  const base = workspaceSearchNavigationKey(href);
  const url = new URL(base, "https://career-gate.invalid");
  const samePage = draft.path === url.pathname;
  const registry = url.pathname === "/staff/clients";
  const responseIndex = draft.searchHrefs.indexOf(base);
  const ownResponse = samePage && !draft.navigating && responseIndex !== -1;
  return {
    base, path: url.pathname,
    value: ownResponse ? draft.value : registry ? url.searchParams.get("q") ?? "" : "",
    scope: samePage ? draft.scope : registry ? "current" : "all", navigating: false,
    searchHrefs: ownResponse ? draft.searchHrefs.slice(responseIndex + 1) : [],
  };
}

/** Adopt explicit intent immediately, including a link to the already-open URL. */
export function prepareWorkspaceSearchNavigation(draft: WorkspaceSearchDraft, href: string): WorkspaceSearchDraft {
  const next = reconcileWorkspaceSearchNavigation({ ...draft, navigating: true }, href);
  return { ...draft, value: next.value, scope: next.scope, searchHrefs: [], navigating: next.base !== draft.base };
}

export function currentRegistrySearchHref(params: string | URLSearchParams, query: string) {
  const next = new URLSearchParams(params);
  const term = query.trim().slice(0, 100);
  if (term) next.set("q", term); else next.delete("q");
  next.delete("page");
  const serialized = next.toString();
  return `/staff/clients${serialized ? `?${serialized}` : ""}`;
}

export function allRegistrySearchHref(query: string) {
  const next = new URLSearchParams({ view: "all" });
  const term = query.trim().slice(0, 100);
  if (term) next.set("q", term);
  return `/staff/clients?${next}`;
}
