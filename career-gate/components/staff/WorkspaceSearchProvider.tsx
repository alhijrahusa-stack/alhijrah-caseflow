"use client";

import { createContext, useCallback, useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { allRegistrySearchHref, currentRegistrySearchHref, prepareWorkspaceSearchNavigation, reconcileWorkspaceSearchNavigation, workspaceSearchNavigationKey, REGISTRY_QUERY_EVENT, type WorkspaceSearchDraft, type WorkspaceSearchScope } from "@/lib/workspace-search";

type NavigateOptions = { replace?: boolean; scroll?: boolean };

type SearchContextValue = {
  query: string; scope: WorkspaceSearchScope; registry: boolean; modalOpen: boolean; pending: boolean;
  setQuery: (query: string) => void; setScope: (scope: WorkspaceSearchScope) => void;
  setModalOpen: (open: boolean) => void; prepareNavigation: (href: string) => void; navigate: (href: string, options?: NavigateOptions) => void;
  currentHref: string; allHref: string;
};
const SearchContext = createContext<SearchContextValue | null>(null);

/** A single draft for the one header field and its keyboard command surface. */
export function WorkspaceSearchProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const router = useRouter();
  const registry = pathname === "/staff/clients";
  const base = workspaceSearchNavigationKey(`${pathname}?${params}`);
  const committed = new URLSearchParams(params).get("q") ?? "";
  const [draft, setDraft] = useState<WorkspaceSearchDraft>({ base, path: pathname, value: registry ? committed : "", scope: registry ? "current" : "all", navigating: false, searchHrefs: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  if (draft.base !== base) {
    const samePage = draft.path === pathname;
    if (!samePage && modalOpen) setModalOpen(false);
    setDraft(reconcileWorkspaceSearchNavigation(draft, base));
  }

  const prepareNavigation = useCallback((href: string) => {
    setDraft(current => prepareWorkspaceSearchNavigation(current, href));
    setModalOpen(false);
  }, [setDraft, setModalOpen]);
  useEffect(() => {
    const restoreHistory = () => prepareNavigation(`${window.location.pathname}${window.location.search}`);
    window.addEventListener("popstate", restoreHistory);
    return () => window.removeEventListener("popstate", restoreHistory);
  }, [prepareNavigation]);

  useEffect(() => {
    if (!registry) return;
    window.dispatchEvent(new CustomEvent(REGISTRY_QUERY_EVENT, { detail: draft.scope === "current" ? draft.value : committed }));
  }, [registry, draft.scope, draft.value, committed]);

  useEffect(() => {
    if (!registry || draft.scope !== "current" || modalOpen || draft.navigating || draft.value.trim() === committed.trim()) return;
    const timer = setTimeout(() => {
      const href = currentRegistrySearchHref(params, draft.value);
      const key = workspaceSearchNavigationKey(href);
      setDraft(current => ({ ...current, searchHrefs: [...new Set([...current.searchHrefs, key])] }));
      startTransition(() => router.replace(href, { scroll: false }));
    }, 220);
    return () => clearTimeout(timer);
  }, [registry, draft.scope, draft.value, draft.navigating, modalOpen, committed, params, router]);

  const navigate = (href: string, options: NavigateOptions = {}) => {
    prepareNavigation(href);
    startTransition(() => options.replace ? router.replace(href, { scroll: options.scroll }) : router.push(href, { scroll: options.scroll }));
  };
  return <SearchContext value={{
    query: draft.value, scope: draft.scope, registry, modalOpen, pending,
    setQuery: value => setDraft(current => ({ ...current, value: value.slice(0, 100), navigating: false })),
    setScope: scope => setDraft(current => ({ ...current, scope: registry ? scope : "all", navigating: false })),
    setModalOpen, prepareNavigation, navigate,
    currentHref: currentRegistrySearchHref(params, draft.value), allHref: allRegistrySearchHref(draft.value),
  }}>{children}</SearchContext>;
}

export function useWorkspaceSearch() {
  const value = useContext(SearchContext);
  if (!value) throw new Error("Workspace search provider missing");
  return value;
}
