"use client";

import { useEffect, useRef, useState } from "react";
import {
  ENGLISH_PROFICIENCY_OPTIONS,
  LANGUAGE_OPTIONS,
  SHIFT_DAY_OPTIONS,
  SMART_FIELD_GROUPS,
  smartAuthorityClass,
  smartFieldStatus,
  smartFieldText,
  smartStateClass,
  type SmartEvidence,
  type SmartField,
} from "@/components/staff/smart/field-contract";
import {
  normalizeEnglishProficiency,
  normalizeImportLanguage,
  normalizeShiftDays,
  normalizeShiftTime,
  normalizeSmartDate,
} from "@/lib/smart-client-fields";

/**
 * Client Data · Validation Matrix.
 *
 * Presentation for the sixteen reviewed fields: a section header once, then one compact
 * row per field. A row is read-only until it is opened for editing, so the matrix is not
 * a wall of input boxes. Committing a row validates that field only, with the same
 * canonical normalizers the server uses, and hands the value to the existing review-save
 * flow — this component never persists anything itself and never holds a second copy of
 * the draft.
 */

export type MatrixCommit = { field: SmartField; value: string | string[] | null };

type Props = {
  read: (field: SmartField) => unknown;
  onCommit: (commit: MatrixCommit) => void;
  evidence: readonly SmartEvidence[];
  missingFields: readonly unknown[];
  conflicts: readonly { field_key?: unknown; field?: unknown }[];
  readOnly: boolean;
  onViewSource?: (evidence: SmartEvidence) => void;
};

/** Validates one field with the canonical normalizer, or passes free text through. */
export function validateField(field: SmartField, raw: string): { value: string | string[] | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: null };
  switch (field.key) {
    case "date_of_birth": {
      const value = normalizeSmartDate(trimmed);
      return value ? { value, error: null } : { value: null, error: "Use YYYY-MM-DD or MM/DD/YYYY with a real calendar date." };
    }
    case "preferred_language": {
      const value = normalizeImportLanguage(trimmed);
      return value ? { value, error: null } : { value: null, error: "Choose a supported language code." };
    }
    case "english_proficiency": {
      const value = normalizeEnglishProficiency(trimmed);
      return value ? { value, error: null } : { value: null, error: "Choose EXCELLENT, GOOD, FAIR, WEAK or NONE." };
    }
    case "shift_days": {
      const value = normalizeShiftDays(trimmed);
      return value ? { value, error: null } : { value: null, error: "Use canonical day codes, a range such as Thu-Mon, Weekdays, Weekend or Daily." };
    }
    case "shift_start_time":
    case "shift_end_time": {
      const value = normalizeShiftTime(trimmed);
      return value ? { value, error: null } : { value: null, error: "Use a valid 12-hour or 24-hour time, for example 6pm or 18:00." };
    }
    default:
      return { value: trimmed, error: null };
  }
}

export function ValidationMatrix({ read, onCommit, evidence, missingFields, conflicts, readOnly, onViewSource }: Props) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="cg-matrix overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Client data validation matrix: the sixteen reviewed Smart fields with their current value, validation state, provenance and authority.
        </caption>
        <thead>
          <tr className="border-b border-white/[.10]">
            <th scope="col" className="px-2 py-2 text-[12px] font-semibold tracking-[.12em] text-slate-400">FIELD</th>
            <th scope="col" className="px-2 py-2 text-[12px] font-semibold tracking-[.12em] text-slate-400">CURRENT VALUE</th>
            <th scope="col" className="px-2 py-2 text-[12px] font-semibold tracking-[.12em] text-slate-400">STATE</th>
            <th scope="col" className="px-2 py-2 text-[12px] font-semibold tracking-[.12em] text-slate-400">PROVENANCE</th>
            <th scope="col" className="px-2 py-2 text-[12px] font-semibold tracking-[.12em] text-slate-400">AUTHORITY</th>
            <th scope="col" className="px-2 py-2 text-right text-[12px] font-semibold tracking-[.12em] text-slate-400">EDIT</th>
          </tr>
        </thead>
        {SMART_FIELD_GROUPS.map((group) => (
          <tbody key={group.title}>
            <tr>
              <th scope="colgroup" colSpan={6} className="px-2 pb-1 pt-4">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold tracking-[.16em] text-[#e3c884]">{group.title}</span>
                  <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-[#b8934a]/25 to-transparent" />
                </span>
              </th>
            </tr>
            {group.fields.map((field) => (
              <MatrixRow
                key={field.key}
                field={field}
                value={read(field)}
                evidence={evidence}
                missingFields={missingFields}
                conflicts={conflicts}
                readOnly={readOnly}
                editing={editing === field.key}
                onEdit={() => setEditing(field.key)}
                onClose={() => setEditing(null)}
                onCommit={onCommit}
                onViewSource={onViewSource}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function MatrixRow({ field, value, evidence, missingFields, conflicts, readOnly, editing, onEdit, onClose, onCommit, onViewSource }: {
  field: SmartField;
  value: unknown;
  evidence: readonly SmartEvidence[];
  missingFields: readonly unknown[];
  conflicts: readonly { field_key?: unknown; field?: unknown }[];
  readOnly: boolean;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onCommit: (commit: MatrixCommit) => void;
  onViewSource?: (evidence: SmartEvidence) => void;
}) {
  const status = smartFieldStatus({ key: field.key, value, evidence, missingFields, conflicts });
  const text = smartFieldText(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = `smart-field-error-${field.key}`;
  const hintId = field.hint ? `smart-field-hint-${field.key}` : undefined;

  function commit(raw: string | string[]) {
    const asText = Array.isArray(raw) ? raw.join(",") : raw;
    const outcome = validateField(field, asText);
    if (outcome.error) { setError(outcome.error); return; }
    setError(null);
    onCommit({ field, value: outcome.value });
    onClose();
  }

  function cancel() {
    setError(null);
    onClose();
  }

  const rowTone =
    status.state === "CONFLICT" ? "border-l-2 border-l-red-300/50"
    : status.state === "MANUAL" ? "border-l-2 border-l-[#d4b06a]/55"
    : "border-l-2 border-l-transparent";

  return (
    <tr data-field={field.key} className={`${rowTone} border-b border-white/[.05] align-middle transition-colors hover:bg-white/[.02]`}>
      <th scope="row" data-label="Field" className="px-2 py-2 text-[13px] font-medium text-slate-200">
        {field.label}
        {field.required && <span className="ml-1 text-amber-300" title="Required field">*</span>}
      </th>
      <td data-label="Current value" className="px-2 py-2">
        {editing && !readOnly ? (
          <MatrixEditor field={field} value={text} onCommit={commit} onCancel={cancel} describedBy={[error ? errorId : null, hintId ?? null].filter(Boolean).join(" ") || undefined} />
        ) : (
          <span key={text} className={`block break-words font-mono text-[15px] leading-6 motion-safe:animate-[cg-field-resolve_180ms_ease-out] ${text ? "text-slate-50" : "text-slate-500"}`}>
            {text || "—"}
          </span>
        )}
        {field.hint && editing && <span id={hintId} className="mt-1 block text-[11px] text-slate-500">{field.hint}</span>}
        {error && <span id={errorId} role="alert" className="mt-1 block text-[12px] leading-5 text-red-300">{error}</span>}
      </td>
      <td data-label="State" className="px-2 py-2">
        <span className={`font-mono text-[12px] font-semibold ${smartStateClass(status.state)}`}>{status.state}</span>
      </td>
      <td data-label="Provenance" className="px-2 py-2">
        <span className="font-mono text-[12px] text-slate-400">{status.provenance ?? "—"}</span>
      </td>
      <td data-label="Authority" className="px-2 py-2">
        <span className={`font-mono text-[12px] font-semibold ${smartAuthorityClass(status.authority)}`}>{status.authority}</span>
      </td>
      <td data-label="Actions" className="px-2 py-2 text-right">
        <span className="inline-flex flex-wrap justify-end gap-1.5">
          {!readOnly && !editing && (
            <button
              type="button"
              onClick={onEdit}
              className="min-h-11 rounded-lg border border-white/12 px-3 text-[13px] font-semibold text-slate-200 transition hover:border-[#d4b06a]/45 hover:bg-[#b8934a]/[.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884]"
            >Edit <span className="sr-only">{field.label}</span></button>
          )}
          {editing && !readOnly && (
            <button
              type="button"
              onClick={cancel}
              className="min-h-11 rounded-lg border border-white/12 px-3 text-[13px] font-semibold text-slate-300 transition hover:bg-white/[.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
            >Cancel <span className="sr-only">editing {field.label}</span></button>
          )}
          {status.evidence?.source_document_id && onViewSource && (
            <button
              type="button"
              onClick={() => onViewSource(status.evidence!)}
              className="min-h-11 rounded-lg border border-cyan-300/25 px-3 text-[13px] font-semibold text-cyan-200 transition hover:bg-cyan-300/[.08] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
            >Source <span className="sr-only">for {field.label}</span></button>
          )}
        </span>
      </td>
    </tr>
  );
}

const EDITOR_CLASS =
  "min-h-11 w-full rounded-lg border border-[#d4b06a]/35 bg-[#010918]/85 px-2.5 font-mono text-[15px] text-slate-50 outline-none transition focus:border-[#e3c884]/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#e3c884]";

function MatrixEditor({ field, value, onCommit, onCancel, describedBy }: {
  field: SmartField;
  value: string;
  onCommit: (raw: string | string[]) => void;
  onCancel: () => void;
  describedBy?: string;
}) {
  const [text, setText] = useState(value);
  const [days, setDays] = useState<string[]>(() => value.split(",").map((item) => item.trim()).filter(Boolean));
  const firstRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
    if (event.key === "Enter" && field.editor !== "shift_days") { event.preventDefault(); onCommit(text); }
  }

  if (field.editor === "shift_days") {
    return (
      <span className="block" onKeyDown={onKeyDown}>
        <span role="group" aria-label={`${field.label} selection`} className="flex flex-wrap gap-1.5">
          {SHIFT_DAY_OPTIONS.map((day, index) => {
            const active = days.includes(day);
            return (
              <button
                key={day}
                ref={index === 0 ? (firstRef as React.Ref<HTMLButtonElement>) : undefined}
                type="button"
                aria-pressed={active}
                onClick={() => setDays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]))}
                className={`min-h-11 min-w-11 rounded-lg border px-2 font-mono text-[13px] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884] ${active ? "border-[#d4b06a]/60 bg-[#b8934a]/[.16] text-[#f3dda4]" : "border-white/12 text-slate-400 hover:bg-white/[.05]"}`}
              >{day}</button>
            );
          })}
        </span>
        <span className="mt-2 flex gap-1.5">
          <button type="button" onClick={() => onCommit(days)} className="min-h-11 rounded-lg border border-[#d4b06a]/55 bg-[#b8934a]/[.14] px-3 text-[13px] font-semibold text-[#f3dda4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e3c884]">Apply</button>
          <button type="button" onClick={() => setDays([])} className="min-h-11 rounded-lg border border-white/12 px-3 text-[13px] font-semibold text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300">Clear</button>
        </span>
      </span>
    );
  }

  if (field.editor === "language" || field.editor === "english_proficiency") {
    const options = field.editor === "language" ? LANGUAGE_OPTIONS : ENGLISH_PROFICIENCY_OPTIONS;
    return (
      <select
        ref={firstRef as React.Ref<HTMLSelectElement>}
        aria-label={field.label}
        aria-describedby={describedBy}
        className={EDITOR_CLASS}
        value={text}
        onKeyDown={onKeyDown}
        onChange={(event) => { setText(event.target.value); onCommit(event.target.value); }}
      >
        <option value="">Not set</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }

  return (
    <input
      ref={firstRef as React.Ref<HTMLInputElement>}
      type={field.editor === "time" ? "time" : field.editor === "date" ? "date" : "text"}
      aria-label={field.label}
      aria-describedby={describedBy}
      className={EDITOR_CLASS}
      value={text}
      onKeyDown={onKeyDown}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onCommit(text)}
    />
  );
}
