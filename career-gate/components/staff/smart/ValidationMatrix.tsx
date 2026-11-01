"use client";

import Link from "next/link";

import { useEffect, useRef, useState } from "react";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { RoyalSelect, RoyalOption } from "@/components/forms/RoyalSelect";
import { RoyalCombobox } from "@/components/forms/RoyalCombobox";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import "@/components/staff/smart/royal-intake.css";
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
  const { t } = useStaffLanguage();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "edited">("all");
  const fields = SMART_FIELD_GROUPS.flatMap((group) => group.fields);
  // Group only fields this system really stores. Travel documents remain in the
  // evidence viewer; no passport values are invented for the employment contract.
  const groups = [
    { title: t("Identity","الهوية"), subtitle: t("Names & date of birth","الأسماء وتاريخ الميلاد"), keys: ["full_name", "first_name", "middle_name", "last_name", "date_of_birth"] },
    { title: t("Contact & language","الاتصال واللغة"), subtitle: t("Contact details, address & communication","بيانات التواصل والعنوان واللغة"), keys: ["phone", "email", "street", "city", "state", "zip", "preferred_language", "english_proficiency"] },
    { title: t("Job preferences","تفضيلات العمل"), subtitle: t("Locations, shifts & additional notes","المواقع والورديات والملاحظات"), keys: fields.map((field) => field.key).filter((key) => !["full_name", "first_name", "middle_name", "last_name", "date_of_birth", "phone", "email", "street", "city", "state", "zip", "preferred_language", "english_proficiency"].includes(key)) },
  ];
  const matches = (field: SmartField) => {
    const status = smartFieldStatus({ key: field.key, value: read(field), evidence, missingFields, conflicts });
    const query = search.trim().toLowerCase();
    return (selected === field.key || !query || `${field.label} ${smartFieldText(read(field))}`.toLowerCase().includes(query))
      && (selected === field.key || filter === "all" || (filter === "edited" ? pendingFields.includes(field.key) || status.authority === "MANUAL" : ["CONFLICT", "MISSING", "REVIEW"].includes(status.state)));
  };
  const visibleCount = fields.filter(matches).length;
  const start = fields.find((field) => field.key === "shift_start_time"), end = fields.find((field) => field.key === "shift_end_time");
  const overnight = start && end ? isOvernightShift(smartFieldText(read(start)), smartFieldText(read(end))) : null;
  function select(key: string | null) { setSelected(key); onEditingChange?.(Boolean(key && !readOnly)); }
  return <div className="cg-matrix cg-validation-cards min-w-0">
    <div className="cg-review-tools"><input type="search" className="cg-review-search" aria-label="Filter client fields" placeholder={t("Find a field or value…","ابحث عن حقل أو قيمة…")} value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="cg-review-filters" role="group" aria-label="Review field filters">{([["all", t("All fields","كل الحقول")], ["attention", t("Needs attention","يحتاج مراجعة")], ["edited", t("Edited fields","حقول معدلة")]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
    <p className="cg-matrix-summary" role="status">{visibleCount} of {fields.length} fields · Select a field to review its value and original evidence.</p>
    <div className="cg-validation-group-grid">{groups.map((group) => {
      const visible = fields.filter((field) => group.keys.includes(field.key) && matches(field));
      return visible.length > 0 && <section className="cg-validation-group" key={group.title} aria-label={`${group.title} review fields`}><header><div><h4>{group.title}</h4><p>{group.subtitle}</p></div><span>{visible.length}</span></header>
        <table className="cg-validation-table"><caption className="sr-only">{group.title} client data validation matrix</caption><thead className="sr-only"><tr><th>Field</th><th>Current value</th><th>Review status</th><th>Review</th></tr></thead><tbody>{visible.map((field) => <MatrixRow key={field.key} field={field} value={read(field)} evidence={evidence} missingFields={missingFields} conflicts={conflicts} readOnly={readOnly} disabled={disabled || Boolean(selected && selected !== field.key)} pending={pendingFields.includes(field.key)} editing={selected === field.key} onEdit={() => select(field.key)} onClose={() => select(null)} onCommit={onCommit} onViewSource={onViewSource} staffNames={staffNames} editHref={editHref} />)}</tbody></table>
      </section>;
    })}</div>
    {visibleCount === 0 && <p className="cg-matrix-summary">No fields match this view. <button type="button" className="cg-review-button" onClick={() => { setSearch(""); setFilter("all"); }}>Show all fields</button></p>}
    {overnight !== null && <p data-smart-overnight={overnight ? "true" : "false"} className="cg-matrix-summary">Shift crosses midnight: <strong>{overnight ? "Yes" : "No"}</strong> · Calculated from the reviewed shift times</p>}
  </div>;
}

function MatrixRow({ field, value, evidence, missingFields, conflicts, readOnly, disabled, pending, editing, onEdit, onClose, onCommit, onViewSource, staffNames, editHref }: {
  field: SmartField; value: unknown; staffNames: Readonly<Record<string, string>>; editHref?: string;
  evidence: readonly SmartEvidence[]; missingFields: readonly unknown[]; conflicts: readonly { field_key?: unknown; field?: unknown }[];
  readOnly: boolean; disabled: boolean; pending: boolean; editing: boolean; onEdit: () => void; onClose: () => void;
  onCommit: (commit: MatrixCommit) => void; onViewSource?: (evidence?: SmartEvidence) => void;
}) {
  const { t } = useStaffLanguage();
  const savedStatus = smartFieldStatus({ key: field.key, value, evidence, missingFields, conflicts });
  const status = pending ? { ...savedStatus, state: "REVIEW" as const } : savedStatus;
  const history = evidence.filter((entry) => canonicalSmartFieldKey(entry.field_key) === field.key);
  const text = smartFieldText(value);
  const [error, setError] = useState<string | null>(null);
  const errorId = `smart-field-error-${field.key}`;
  const stateLabel = pending ? "Pending save" : status.state === "DETECTED" ? `${["document","image","pdf","ocr","paddle_ocr"].includes(status.provenance ?? "") ? "✨ " : ""}Detected` : status.state === "VERIFIED" ? "✓ Verified" : status.state === "MANUAL" ? "✓ Staff reviewed" : status.state;
  function commit(raw: string | string[]) {
    const result = validateField(field, Array.isArray(raw) ? raw.join(",") : raw);
    if (result.error) { setError(result.error); return; }
    setError(null); onCommit({ field, value: result.value }); onClose();
  }
  return <tr data-field={field.key} data-authority={status.authority} className={`cg-validation-row ${pending ? "has-edit" : ""}`} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,a") && !disabled) onEdit(); }}>
    <th scope="row" data-label="Field">{field.label}{field.required && <span title="Required identity field"> *</span>}{pending && <small className="cg-unsaved-change">Unsaved change</small>}</th>
    <td data-label="Current value"><span dir="ltr" className={text ? "" : "is-missing"}>{text || "Not supplied"}</span></td>
    <td data-label="Review status"><span data-label="State" data-review-state={status.state} className={`cg-review-state ${smartStateClass(status.state)} ${status.authority === "MANUAL" ? "cg-authority-manual" : ""}`}>{stateLabel}</span><small data-label="Provenance">{status.provenance === "local_text" ? "Captured text" : status.provenance ?? "No source recorded"}</small><small data-label="Authority" className={smartAuthorityClass(status.authority)}>{status.authority}</small></td>
    <td data-label="Actions"><button type="button" className="cg-review-button" aria-label={`${readOnly ? "Review" : "Edit"} ${field.label}`} disabled={disabled} aria-haspopup="dialog" aria-expanded={editing} onClick={onEdit}>{t("Review","مراجعة")} ↗</button>
      {editing && <GlassReviewDialog title={`${field.label} · ${t("Review","مراجعة")}`} drawer onClose={() => { setError(null); onClose(); }}>
        <div className="cg-field-drawer-value"><span data-review-state={status.state} className={`cg-review-state ${smartStateClass(status.state)}`}>{stateLabel}</span><p dir="ltr">{text || "Not supplied"}</p><small>{status.authority === "MANUAL" ? "Last recorded authority: staff review" : "Source reading: verify against the attached evidence"}</small></div>
        {!readOnly ? <section className="cg-field-editor"><h3>Review value</h3><MatrixEditor field={field} value={text} onCommit={commit} onCancel={onClose} describedBy={error ? errorId : undefined} invalid={Boolean(error)} />{field.hint && <p>{field.hint}</p>}{savedStatus.state === "CONFLICT" && <p>Apply confirms this value and records the resolution when the review is saved.</p>}{error && <p id={errorId} role="alert">{error}</p>}</section> : editHref && <Link className="cg-review-button" href={editHref}>Edit {field.label} in Client</Link>}
        {onViewSource && <button type="button" className="cg-review-button cg-source-action" onClick={() => { onClose(); onViewSource(status.evidence ?? { field_key: field.key }); }}>View source document</button>}
        <section role="region" aria-label={`${field.label} evidence history`} className="cg-field-history"><h3>Evidence & audit history</h3><p>{history.length} recorded {history.length === 1 ? "entry" : "entries"}</p>
          {pending && <p>The current manual change enters the audit history when you save or approve.</p>}
          {history.length ? <ol>{history.map((entry, index) => <li key={index}><strong>{entry.authority === "MANUAL" || entry.source_type === "manual_review" ? "Staff review" : entry.source_type?.replaceAll("_", " ") || "Source"}{entry.source_page ? ` · Page ${entry.source_page}` : ""}</strong><p dir="ltr">{smartFieldText(entry.normalized_value ?? entry.value) || "Value cleared"}</p>{entry.previous_value !== undefined && <small>Previous value: {smartFieldText(entry.previous_value) || "Empty"}</small>}{entry.resolution && <small>Conflict explicitly resolved by staff</small>}{entry.source_text_reference && <blockquote>{entry.source_text_reference}</blockquote>}{entry.reviewer_id && <small>Reviewer: {staffNames[entry.reviewer_id] ?? entry.reviewer_id}</small>}{entry.actor_id && entry.actor_id !== entry.reviewer_id && <small>Edited by: {staffNames[entry.actor_id] ?? entry.actor_id}</small>}{entry.reviewed_at && <small>{new Date(entry.reviewed_at).toLocaleString("en-US", { timeZone: "America/Detroit" })}</small>}{entry.source_document_id && onViewSource && <button type="button" className="cg-review-button" onClick={() => { onClose(); onViewSource(entry); }}>View document</button>}</li>)}</ol> : <p>No evidence has been recorded for this field.</p>}
        </section>
      </GlassReviewDialog>}
    </td>
  </tr>;
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
  const firstRef = useRef<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
    if (event.key === "Enter" && event.target === firstRef.current && field.editor !== "shift_days" && field.editor !== "notes" && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); onCommit(text); }
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
    return controls(
      <>
        <RoyalCombobox
          options={SHIFT_TYPE_OPTIONS}
          ref={firstRef as React.Ref<HTMLInputElement>}
          type="text"
          aria-label={field.label}
          aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
          className={EDITOR_CLASS}
          value={text}
          onKeyDown={onKeyDown}
          onChange={(event) => setText(event.target.value)}
          />
      </>
    );
  }

  if (field.editor === "language" || field.editor === "english_proficiency") {
    const options = field.editor === "language" ? LANGUAGE_OPTIONS : ENGLISH_PROFICIENCY_OPTIONS;
    return controls(
      <RoyalSelect
        ref={firstRef as React.Ref<HTMLButtonElement>}
        aria-label={field.label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={EDITOR_CLASS}
        value={text}
        onKeyDown={onKeyDown}
        onChange={(event) => setText(event.target.value)}
      >
        <RoyalOption value="">Not set</RoyalOption>
        {options.map((option) => <RoyalOption key={option.value} value={option.value}>{option.label}</RoyalOption>)}
      </RoyalSelect>
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
