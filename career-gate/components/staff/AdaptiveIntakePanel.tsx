"use client";

import { useMemo } from "react";
import type { PrefState } from "@/components/forms/preferences";
import { optionByKey } from "@/components/forms/preferences";
import type { ProfileForm } from "@/components/forms/ProfileFields";
import type { PendingDocument } from "@/components/staff/SmartDocumentDropzone";
import { DOC_LABELS, type DOC_TYPES } from "@/lib/domain";

type DocType = (typeof DOC_TYPES)[number];

type Props = {
  profile: ProfileForm;
  prefs: PrefState;
  docs: PendingDocument[];
  assigned: string;
  consent: boolean;
};

type Check = { label: string; weight: number; ok: boolean; required?: boolean };

function answered(value: string) { return value.trim().length > 0; }
function hasDoc(docs: PendingDocument[], type: DocType) { return docs.some((doc) => doc.doc_type === type); }

export function AdaptiveIntakePanel({ profile, prefs, docs, assigned, consent }: Props) {
  const analysis = useMemo(() => {
    const amazonAnswered = [profile.amazon_worked_before, profile.amazon_applied_before, profile.currently_amazon, profile.via_agency].every(Boolean);
    const checks: Check[] = [
      { label: "Full name", weight: 8, ok: profile.full_name.trim().length >= 2, required: true },
      { label: "Phone", weight: 8, ok: profile.phone.replace(/\D/g, "").length >= 10, required: true },
      { label: "Email", weight: 6, ok: /.+@.+\..+/.test(profile.email), required: true },
      { label: "Date of birth", weight: 6, ok: answered(profile.date_of_birth), required: true },
      { label: "Complete address", weight: 8, ok: [profile.street, profile.city, profile.state, profile.zip].every(answered), required: true },
      { label: "Appointment availability", weight: 6, ok: answered(profile.appointment_availability), required: true },
      { label: "Amazon history", weight: 10, ok: amazonAnswered, required: true },
      { label: "Employment history", weight: 6, ok: profile.employment_history.length > 0 && profile.employment_history.every((row) => answered(row.job_title) && (row.self_employed || answered(row.company))) },
      { label: "Primary site / shift preference", weight: 12, ok: prefs.primary.length > 0, required: true },
      { label: DOC_LABELS.photo_id, weight: 8, ok: hasDoc(docs, "photo_id"), required: true },
      { label: DOC_LABELS.work_authorization, weight: 8, ok: hasDoc(docs, "work_authorization"), required: true },
      { label: DOC_LABELS.social_security_card, weight: 4, ok: hasDoc(docs, "social_security_card") },
      { label: "Assigned staff", weight: 5, ok: Boolean(assigned), required: true },
      { label: "Communication consent recorded", weight: 5, ok: consent },
    ];
    const score = checks.reduce((sum, item) => sum + (item.ok ? item.weight : 0), 0);
    const missing = checks.filter((item) => !item.ok);
    const requiredMissing = missing.filter((item) => item.required);
    const selected = prefs.primary.map(optionByKey).filter(Boolean);
    const level = score >= 90 && requiredMissing.length === 0 ? "ready" : score >= 60 ? "progress" : "attention";
    return { checks, score, missing, requiredMissing, selected, level };
  }, [profile, prefs, docs, assigned, consent]);

  function readGuidance() {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const text = analysis.requiredMissing.length
      ? `Readiness ${analysis.score} percent. Required items still needed: ${analysis.requiredMissing.map((item) => item.label).join(", ")}.`
      : `Readiness ${analysis.score} percent. No required intake items are missing.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = profile.preferred_language === "ar" ? "ar-SA" : profile.preferred_language === "es" ? "es-US" : "en-US";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <aside className="cg-intelligence-card rounded-2xl p-5" data-level={analysis.level} aria-label="Adaptive intake intelligence">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.18em] text-cyan-200/80">Adaptive Intake Intelligence</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">Readiness & next best action</h2>
          <p className="mt-1 text-xs text-slate-500">Live deterministic checks. No field is changed automatically.</p>
        </div>
        <div className="cg-readiness-ring" style={{ "--cg-score": analysis.score } as React.CSSProperties}><strong>{analysis.score}%</strong></div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
          <p className="text-xs font-semibold text-slate-300">Priority</p>
          <p className="mt-1 text-sm text-slate-100">{analysis.requiredMissing[0]?.label ?? "Required intake complete"}</p>
        </div>
        <div className="rounded-xl border border-white/[.06] bg-white/[.02] p-3">
          <p className="text-xs font-semibold text-slate-300">Selected opportunity</p>
          <p className="mt-1 truncate text-sm text-slate-100">{analysis.selected[0] ? `${analysis.selected[0].site_name} · ${analysis.selected[0].shift_name}` : "No primary shift selected"}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {analysis.selected.slice(0, 4).map((option) => option && <span key={option.key} className="cg-mini-chip">{option.site_code} · {option.shift_name}</span>)}
        {analysis.selected.length > 4 && <span className="cg-mini-chip">+{analysis.selected.length - 4} more</span>}
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-200">Live guidance</h3>
          <button type="button" onClick={readGuidance} className="rounded-lg border border-cyan-300/20 bg-cyan-300/[.05] px-2.5 py-1.5 text-xs text-cyan-100 hover:bg-cyan-300/[.09]">Read aloud</button>
        </div>
        {analysis.missing.length ? (
          <ul className="mt-3 space-y-2">
            {analysis.missing.slice(0, 7).map((item) => (
              <li key={item.label} className="flex items-start justify-between gap-3 rounded-xl border border-white/[.055] bg-white/[.018] px-3 py-2 text-sm">
                <span className="text-slate-300">{item.label}</span>
                <span className={item.required ? "text-amber-300" : "text-slate-500"}>{item.required ? "Required" : "Recommended"}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[.05] p-3 text-sm text-emerald-200">All tracked readiness checks are complete.</p>}
      </div>
    </aside>
  );
}
