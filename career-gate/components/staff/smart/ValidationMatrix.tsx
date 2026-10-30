"use client";

import Link from "next/link";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  ENGLISH_PROFICIENCY_OPTIONS,
  canonicalSmartFieldKey,
  LANGUAGE_OPTIONS,
  SHIFT_DAY_OPTIONS,
  SHIFT_TYPE_OPTIONS,
  SMART_FIELD_GROUPS,
  smartAuthorityClass,
  smartFieldStatus,
  smartFieldText,
  smartStateClass,
  type SmartEvidence,
  type SmartField,
} from "@/components/staff/smart/field-contract";
import {
  isOvernightShift,
  normalizeEnglishProficiency,
  normalizeImportLanguage,
  normalizeShiftDays,
  normalizeShiftTime,
  normalizeSmartDate,
} from "@/lib/smart-client-fields";

/**
 * Client Data · Validation Matrix.
 *
 * Presentation for the reviewed fields: a section header once, then one compact
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
  onViewSource?: (evidence?: SmartEvidence) => void;
  onEditingChange?: (editing: boolean) => void;
  pendingFields?: readonly string[];
  disabled?: boolean;
  staffNames?: Readonly<Record<string, string>>;
  editHref?: string;
};

/** Validates one field with the canonical normalizer, or passes free text through. */
export function validateField(field: SmartField, raw: string): { value: string | string[] | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return field.required ? { value: null, error: `${field.label} is required.` } : { value: null, error: null };
  switch (field.key) {
    case "full_name":
      return trimmed.length >= 2 && trimmed.length <= 160 ? { value: trimmed, error: null } : { value: null, error: "Use a full name between 2 and 160 characters." };
    case "phone": {
      const digits = trimmed.replace(/\D/g, "");
      const value = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
      return value.length === 10 ? { value, error: null } : { value: null, error: "Enter a 10-digit US phone number." };
    }
    case "email":
      return trimmed.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? { value: trimmed.toLowerCase(), error: null } : { value: null, error: "Enter a valid email address." };
    case "zip":
      return /^\d{5}(-\d{4})?$/.test(trimmed) ? { value: trimmed, error: null } : { value: null, error: "Use a 5-digit ZIP or ZIP+4." };
    case "state":
      return trimmed.length <= 40 ? { value: trimmed, error: null } : { value: null, error: "State must be 40 characters or fewer." };

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

export function ValidationMatrix({ read, onCommit, evidence, missingFields, conflicts, readOnly, onViewSource, onEditingChange, pendingFields = [], disabled = false, staffNames = {}, editHref }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "edited">("all");
  const fields = SMART_FIELD_GROUPS.flatMap((group) => group.fields);
  const matches = (field: SmartField) => {
    const status = smartFieldStatus({ key: field.key, value: read(field), evidence, missingFields, conflicts });
    const query = search.trim().toLowerCase();
    return (editing === field.key || !query || `${field.label} ${smartFieldText(read(field))}`.toLowerCase().includes(query))
      && (editing === field.key || filter === "all" || (filter === "edited" ? pendingFields.includes(field.key) || status.authority === "MANUAL" : ["CONFLICT", "MISSING", "REVIEW"].includes(status.state)));
  };
  const visibleCount = fields.filter(matches).length;
  const shiftStart = fields.find((field) => field.key === "shift_start_time");
  const shiftEnd = fields.find((field) => field.key === "shift_end_time");
  const overnight = shiftStart && shiftEnd ? isOvernightShift(smartFieldText(read(shiftStart)), smartFieldText(read(shiftEnd))) : null;

  return (
    <div className="cg-matrix min-w-0">
      <div className="cg-review-tools">
        <input type="search" className="cg-review-search" aria-label="Filter client fields" placeholder="Find a field or value…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="cg-review-filters" role="group" aria-label="Review field filters">
          {([["all", "All fields"], ["attention", "Needs attention"], ["edited", "Edited fields"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-400" role="status">{visibleCount} of {fields.length} fields{editing ? " · Apply or cancel the current edit to continue." : " · Select Audit to inspect the recorded evidence."}</p>
      <table className="w-full table-fixed border-collapse text-left">
        <caption className="sr-only">Client data validation matrix: every reviewed Smart field with its current value, validation state, provenance and authority.</caption>
        <thead><tr>
          <th scope="col" className="w-[20%]">Field</th>
          <th scope="col" className="w-[35%]">Current value</th>
          <th scope="col" className="w-[24%]">Review status</th>
          <th scope="col" className="w-[21%] text-right">Actions</th>
        </tr></thead>
        {SMART_FIELD_GROUPS.map((group) => {
          const visible = group.fields.filter(matches);
          return visible.length > 0 && <tbody key={group.title}>
            <tr className="cg-matrix-group"><th scope="colgroup" colSpan={4}><span>{group.title}</span><span className="ml-2 font-normal text-slate-500">{visible.length}</span></th></tr>
            {visible.map((field) => <MatrixRow key={field.key} field={field} value={read(field)} evidence={evidence} missingFields={missingFields} conflicts={conflicts} readOnly={readOnly} disabled={disabled || Boolean(editing && editing !== field.key)} pending={pendingFields.includes(field.key)} editing={editing === field.key} onEdit={() => { setEditing(field.key); onEditingChange?.(true); }} onClose={() => { setEditing(null); onEditingChange?.(false); }} onCommit={onCommit} onViewSource={onViewSource} staffNames={staffNames} editHref={editHref} />)}
          </tbody>;
        })}
      </table>
      {visibleCount === 0 && <div className="rounded-xl border border-dashed border-white/15 p-6 text-center text-sm text-slate-400">No fields match this view. <button type="button" className="text-cyan-200 underline underline-offset-4" onClick={() => { setSearch(""); setFilter("all"); }}>Show all fields</button></div>}
      {overnight !== null && <p data-smart-overnight={overnight ? "true" : "false"} className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />Shift crosses midnight: <strong className="text-slate-200">{overnight ? "Yes" : "No"}</strong><span>· Calculated from the reviewed shift times</span></p>}
    </div>
  );
}

function MatrixRow({ field, value, evidence, missingFields, conflicts, readOnly, disabled, pending, editing, onEdit, onClose, onCommit, onViewSource, staffNames, editHref }: {
  field: SmartField;
  value: unknown;
  staffNames: Readonly<Record<string, string>>;
  editHref?: string;
  evidence: readonly SmartEvidence[];
  missingFields: readonly unknown[];
  conflicts: readonly { field_key?: unknown; field?: unknown }[];
  readOnly: boolean;
  disabled: boolean;
  pending: boolean;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onCommit: (commit: MatrixCommit) => void;
  onViewSource?: (evidence?: SmartEvidence) => void;
}) {
  const savedStatus = smartFieldStatus({ key: field.key, value, evidence, missingFields, conflicts });
  const status = pending ? { ...savedStatus, state: "REVIEW" as const } : savedStatus;
  const [auditOpen, setAuditOpen] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const history = evidence.filter((entry) => canonicalSmartFieldKey(entry.field_key) === field.key);
  const auditId = `smart-field-history-${field.key}`;
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
    requestAnimationFrame(() => editRef.current?.focus());
  }

  function cancel() {
    setError(null);
    onClose();
    requestAnimationFrame(() => editRef.current?.focus());
  }

  const rowTone =
    status.state === "CONFLICT" ? "border-l-2 border-l-red-300/50"
    : status.state === "MANUAL" ? "border-l-2 border-l-[#d4b06a]/55"
    : "border-l-2 border-l-transparent";

  return (
    <Fragment>
    <tr data-field={field.key} className={`${rowTone} ${editing ? "cg-matrix-editing" : ""} border-b border-white/[.06] align-top`}>
      <th scope="row" data-label="Field" className="px-3 py-4 text-[13px] font-medium text-slate-200">
        {field.label}{field.required && <span className="ml-1 text-amber-300" title="Required field">*</span>}
        {pending && <span className="mt-1 block text-[11px] font-normal text-amber-200">Unsaved change</span>}
      </th>
      <td data-label="Current value" className="px-3 py-4">
        {editing && !readOnly ? <MatrixEditor field={field} value={text} onCommit={commit} onCancel={cancel} describedBy={[error ? errorId : null, hintId ?? null].filter(Boolean).join(" ") || undefined} invalid={Boolean(error)} /> : <span key={text} className={`block break-words text-[14px] leading-6 ${text ? "text-slate-50" : "text-slate-500"}`}>{text || "—"}</span>}
        {field.hint && editing && <span id={hintId} className="mt-1 block text-xs text-slate-400">{field.hint}</span>}
        {error && <span id={errorId} role="alert" className="mt-1 block text-xs leading-5 text-red-300">{error}</span>}
        {editing && savedStatus.state === "CONFLICT" && <p className="mt-2 text-xs leading-5 text-amber-200">Apply confirms this value and resolves this field’s conflict when the review is saved.</p>}
      </td>
      <td data-label="Review status" className="px-3 py-4">
        <span data-label="State" className={`cg-review-state ${smartStateClass(status.state)}`}>{pending ? "PENDING SAVE" : status.state}</span>
        <span data-label="Provenance" className="mt-2 block break-words text-xs text-slate-400">{status.provenance === "local_text" ? "Captured text" : status.provenance ?? "No source recorded"}</span>
        <span data-label="Authority" className={`mt-1 block text-[10px] font-semibold tracking-[.12em] ${smartAuthorityClass(status.authority)}`}>{status.authority}</span>
      </td>
      <td data-label="Actions" className="px-3 py-3 text-right">
        <div className="flex flex-wrap justify-end gap-1.5">
          {!readOnly && !editing && <button ref={editRef} disabled={disabled} type="button" onClick={onEdit} className="cg-review-button">Edit <span className="sr-only">{field.label}</span></button>}
          <button type="button" className="cg-review-button cg-review-audit" aria-expanded={auditOpen} aria-controls={auditId} onClick={() => setAuditOpen((open) => !open)}>Audit <span className="sr-only">{field.label}</span></button>
          {readOnly && editHref && <Link href={editHref} className="cg-review-button">Edit <span className="sr-only">{field.label}</span></Link>}
          {onViewSource && <button type="button" onClick={() => onViewSource(status.evidence ?? { field_key: field.key })} className="cg-review-button cg-review-audit">Source <span className="sr-only">for {field.label}</span></button>}
        </div>
      </td>
    </tr>
    {auditOpen && <tr className="cg-matrix-audit-row"><td colSpan={4} className="p-3">
      <section id={auditId} role="region" aria-label={`${field.label} evidence history`} className="cg-field-history">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-slate-100">{field.label} · Evidence history</h4><span className="text-xs text-slate-400">{history.length} recorded {history.length === 1 ? "entry" : "entries"}</span></div>
        {pending && <p className="mb-3 text-xs text-amber-200">The current change will enter the audit history when you save or approve the review.</p>}
        {history.length ? <ol className="space-y-3">{history.map((entry, index) => <li key={index} className="rounded-lg border border-white/[.08] bg-black/15 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium text-cyan-200">{index + 1} · {entry.authority === "MANUAL" || entry.source_type === "manual_review" ? "Staff review" : entry.source_type?.replaceAll("_", " ") || "Source"}{entry.source_page ? ` · Page ${entry.source_page}` : ""}</span><span className="text-slate-400">{entry.verification_state?.replaceAll("_", " ")}</span></div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-100">{smartFieldText(entry.normalized_value ?? entry.value) || "Value cleared"}</p>
          {entry.normalized_value != null && smartFieldText(entry.normalized_value) !== smartFieldText(entry.value) && <p className="mt-1 break-words text-xs text-slate-400">Original reading: {smartFieldText(entry.value) || "Empty"}</p>}
          {entry.previous_value !== undefined && <p className="mt-1 break-words text-xs text-slate-400">Previous value: {smartFieldText(entry.previous_value) || "Empty"}</p>}
          {entry.resolution && <p className="mt-1 text-xs text-emerald-200">Conflict explicitly resolved by staff</p>}
          {entry.source_text_reference && <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-cyan-300/25 pl-3 text-xs leading-5 text-slate-400">{entry.source_text_reference}</blockquote>}
          {(entry.reviewer_id || entry.reviewed_at) && <p className="mt-2 break-words text-xs text-slate-400">{entry.reviewer_id ? `Reviewer: ${staffNames[entry.reviewer_id] ?? entry.reviewer_id}` : ""}{entry.reviewed_at ? ` · ${new Date(entry.reviewed_at).toLocaleString("en-US", { timeZone: "America/Detroit" })}` : ""}</p>}
          {entry.actor_id && entry.actor_id !== entry.reviewer_id && <p className="mt-1 break-words text-xs text-slate-400">Edited by: {staffNames[entry.actor_id] ?? entry.actor_id}</p>}
          {entry.source_document_id && onViewSource && <button type="button" className="cg-review-button cg-review-audit mt-2" onClick={() => onViewSource(entry)}>View document</button>}
        </li>)}</ol> : <p className="text-sm text-slate-400">No evidence has been recorded for this field.</p>}
      </section>
    </td></tr>}
    </Fragment>
  );
}

const EDITOR_CLASS =
  "min-h-11 w-full rounded-lg border border-[#d4b06a]/35 bg-[#010918]/85 px-2.5 font-mono text-[15px] text-slate-50 outline-none transition focus:border-[#e3c884]/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#e3c884]";

function MatrixEditor({ field, value, onCommit, onCancel, describedBy, invalid }: {
  field: SmartField;
  value: string;
  onCommit: (raw: string | string[]) => void;
  onCancel: () => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value);
  const [days, setDays] = useState<string[]>(() => value.split(",").map((item) => item.trim()).filter(Boolean));
  const firstRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
    if (event.key === "Enter" && event.target === firstRef.current && field.editor !== "shift_days" && field.editor !== "notes" && !(event.target instanceof HTMLSelectElement)) { event.preventDefault(); onCommit(text); }
  }

  const controls = (editor: React.ReactNode, raw: string | string[] = text) => <div className="space-y-2">{editor}<div className="flex flex-wrap gap-2"><button type="button" className="cg-review-button cg-review-apply" onClick={() => onCommit(raw)}>Apply</button><button type="button" className="cg-review-button" onClick={onCancel}>Cancel <span className="sr-only">editing {field.label}</span></button></div></div>;

  if (field.editor === "shift_days") {
    return controls(
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

      </span>, days
    );
  }

  if (field.editor === "notes") {
    return controls(
      <textarea
        ref={firstRef as React.Ref<HTMLTextAreaElement>}
        rows={4}
        aria-label={field.label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={`${EDITOR_CLASS} resize-y py-2 leading-6`}
        value={text}
        onKeyDown={onKeyDown}
        onChange={(event) => setText(event.target.value)}
      />
    );
  }

  if (field.editor === "shift") {
    // Free text stays valid on this field, so an operational shift name the office
    // already uses is offered alongside the canonical types rather than replaced.
    const listId = `smart-shift-options-${field.key}`;
    return controls(
      <>
        <input
          ref={firstRef as React.Ref<HTMLInputElement>}
          list={listId}
          type="text"
          aria-label={field.label}
          aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
          className={EDITOR_CLASS}
          value={text}
          onKeyDown={onKeyDown}
          onChange={(event) => setText(event.target.value)}
          />
        <datalist id={listId}>
          {SHIFT_TYPE_OPTIONS.map((option) => <option key={option} value={option} />)}
        </datalist>
      </>
    );
  }

  if (field.editor === "language" || field.editor === "english_proficiency") {
    const options = field.editor === "language" ? LANGUAGE_OPTIONS : ENGLISH_PROFICIENCY_OPTIONS;
    return controls(
      <select
        ref={firstRef as React.Ref<HTMLSelectElement>}
        aria-label={field.label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={EDITOR_CLASS}
        value={text}
        onKeyDown={onKeyDown}
        onChange={(event) => setText(event.target.value)}
      >
        <option value="">Not set</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }

  return controls(
    <input
      ref={firstRef as React.Ref<HTMLInputElement>}
      type={field.editor === "time" ? "time" : field.editor === "date" ? "date" : "text"}
      aria-label={field.label}
      aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
      className={EDITOR_CLASS}
      value={text}
      onKeyDown={onKeyDown}
      onChange={(event) => setText(event.target.value)}
    />
  );
}
