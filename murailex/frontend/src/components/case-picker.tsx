"use client";

import { Briefcase, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";

export type CaseRow = { id: string; reference: string; title: string; recordings: number };

export function useCases(): [CaseRow[], (rows: CaseRow[]) => void] {
  const [cases, setCases] = useState<CaseRow[]>([]);
  useEffect(() => {
    api<{ cases: CaseRow[] }>("/api/cases").then((r) => setCases(r.cases)).catch(() => undefined);
  }, []);
  return [cases, setCases];
}

/** Files a recording in a case. The choice is applied optimistically and rolled back if the
 * server refuses it; filing never changes the recording, its transcript or any hash. */
export function CasePicker({ recordingId, caseId, canEdit, rtl }: { recordingId: string; caseId: string | null; canEdit: boolean; rtl: boolean }) {
  const toast = useToast();
  const [cases, setCases] = useCases();
  const [value, setValue] = useState<string | null>(caseId);
  const [creating, setCreating] = useState(false);
  const [reference, setReference] = useState("");

  async function assign(next: string | null) {
    const before = value;
    setValue(next); // optimistic
    try {
      await api(`/api/recordings/${recordingId}/case`, { method: "POST", json: { case_id: next } });
      toast(next ? (rtl ? "أُضيف إلى القضية" : "Filed in case") : rtl ? "أُزيل من القضية" : "Removed from case");
    } catch (e) {
      setValue(before);
      toast(e instanceof ApiError ? e.message : "Error", "danger");
    }
  }

  async function create() {
    const ref = reference.trim();
    if (!ref) return;
    try {
      const r = await api<{ case: CaseRow }>("/api/cases", { method: "POST", json: { reference: ref, title: "" } });
      setCases([r.case, ...cases]);
      setCreating(false);
      setReference("");
      await assign(r.case.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Error", "danger");
    }
  }

  const current = cases.find((c) => c.id === value);
  if (!canEdit) {
    return current ? (
      <div className="flex items-center gap-2 text-xs text-fg-muted"><Briefcase className="size-3.5" /> <bdi>{current.reference}</bdi></div>
    ) : null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="case-picker">
      <Briefcase className="size-4 text-primary-text" aria-hidden />
      {creating ? (
        <>
          <Input
            autoFocus
            dir="auto"
            placeholder={rtl ? "رقم أو مرجع القضية" : "Case number or reference"}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            className="h-9 w-56"
            data-testid="case-reference"
          />
          <Button size="sm" onClick={create} data-testid="case-create">{rtl ? "إنشاء" : "Create"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>{rtl ? "إلغاء" : "Cancel"}</Button>
        </>
      ) : (
        <>
          <Select
            aria-label={rtl ? "القضية" : "Case"}
            value={value ?? ""}
            onChange={(e) => void assign(e.target.value || null)}
            className="h-9 w-auto min-w-44"
            data-testid="case-select"
          >
            <option value="">{rtl ? "بلا قضية" : "No case"}</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>{c.reference}{c.title ? ` — ${c.title}` : ""}</option>
            ))}
          </Select>
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)} data-testid="case-new">
            <Plus /> {rtl ? "قضية جديدة" : "New case"}
          </Button>
        </>
      )}
    </div>
  );
}
