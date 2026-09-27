"use client";

import { useRef, useState } from "react";
import { useAction } from "@/components/forms/useAction";

/**
 * Click to edit; Enter saves, Esc cancels. The new value is shown only after
 * the server confirms. On failure the original value is restored.
 */
export function InlineField({
  clientId,
  field,
  value,
  display,
  type = "text",
  options,
  label,
  multiline,
}: {
  clientId: string;
  field: string;
  value: string | null;
  display?: string;
  type?: "text" | "email" | "tel" | "date";
  options?: { value: string; label: string }[];
  label: string;
  multiline?: boolean;
}) {
  const { run, pending } = useAction({ successMessage: `${label} saved` });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [shown, setShown] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);

  const start = () => {
    setDraft(value ?? "");
    setEditing(true);
    setTimeout(() => ref.current?.focus(), 0);
  };
  const cancel = () => {
    setEditing(false);
    setDraft(value ?? "");
  };
  const save = async () => {
    if ((draft || null) === (value || null)) return cancel();
    const r = await run({ action: "patch_client", client_id: clientId, field, value: draft });
    if (r) {
      setShown(null);
      setEditing(false);
    } else {
      // Roll back to the server value and keep the editor open for correction.
      setDraft(value ?? "");
      // The input is disabled while saving; focus once it is re-enabled.
      setTimeout(() => ref.current?.focus(), 0);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
    if (e.key === "Enter" && !(multiline && e.shiftKey)) {
      e.preventDefault();
      void save();
    }
  };

  if (!editing) {
    return (
      <button type="button" onClick={start} data-testid={`inline-${field}`}
        className="group -mx-1 w-full rounded px-1 text-left transition-colors duration-200 hover:bg-brand-50 focus:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-100"
        aria-label={`Edit ${label}`}>
        <span className={value ? "" : "text-slate-400"}>{shown ?? display ?? (value || "—")}</span>
        <span className="ml-2 text-xs text-slate-400 opacity-0 group-hover:opacity-100">Edit</span>
      </button>
    );
  }

  const common = {
    ref,
    "aria-label": label,
    value: draft,
    disabled: pending,
    onKeyDown: onKey,
    className: "input py-1",
  };
  return (
    <div className="flex items-start gap-1" data-testid={`inline-edit-${field}`}>
      {options ? (
        <select {...common} onChange={(e) => setDraft(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : multiline ? (
        <textarea {...common} rows={2} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input {...common} type={type} onChange={(e) => setDraft(e.target.value)} />
      )}
      <button type="button" onClick={save} disabled={pending} className="rounded bg-brand-600 px-2 py-1 text-xs text-white">{pending ? "…" : "Save"}</button>
      <button type="button" onClick={cancel} disabled={pending} className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100">Esc</button>
    </div>
  );
}
