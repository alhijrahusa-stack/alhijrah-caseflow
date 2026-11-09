"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { publishMutation } from "@/components/staff/realtime/update-bus";
import { IMPORT_REVIEW_REASONS } from "@/lib/import-duplicate-contract";
import { dateTime } from "@/lib/format";
import styles from "./ImportDuplicateCenter.module.css";

type TrashRow = { id: string; ref: string; full_name: string; phone: string; archived_at: string; archived_by: string; documents: number; reason: string | null };
export function ImportTrash() {
  const { t } = useStaffLanguage();
  const [rows, setRows] = useState<TrashRow[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const pending = useRef(false), retries = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/staff/import-duplicate-review?mode=trash", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? t("Unable to load import trash", "تعذر تحميل سلة الاستيراد"));
      setRows(data.result.rows); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Loading failed", "تعذر التحميل")); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function restore(id: string) {
    if (pending.current) return;
    pending.current = true; setBusy(id); setError(""); setNotice("");
    if (!retries.current.has(id)) retries.current.set(id, crypto.randomUUID());
    try {
      const response = await fetch("/api/staff/import-duplicate-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore", case_id: id, operation_id: retries.current.get(id) }) });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error?.message ?? t("Restore not confirmed", "لم تتأكد الاستعادة"));
      retries.current.delete(id); setRows(previous => previous.filter(row => row.id !== id)); setNotice(t("The same import file was restored with its documents and history.", "استُعيد ملف الاستيراد نفسه بوثائقه وسجله.")); publishMutation("import_restored", null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("Unable to restore", "تعذرت الاستعادة")); }
    finally { pending.current = false; setBusy(""); }
  }
  return <section className={styles.surface} data-testid="import-trash"><div className={styles.heading}><div><p className={styles.eyebrow}>{t("RECOVERABLE IMPORT FILES", "ملفات الاستيراد القابلة للاستعادة")}</p><h3>{t("Import trash", "سلة ملفات الاستيراد")}</h3></div><ActionButton type="button" className={styles.button} disabled={loading || Boolean(busy)} onClick={() => load()}>{t("Refresh", "تحديث")}</ActionButton></div>
    {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.success} role="status">{notice}</p>}
    {loading ? <p className={styles.muted} role="status">{t("Loading…", "جارٍ التحميل…")}</p> : !error && !rows.length ? <p className={styles.muted}>{t("No import files in trash.", "لا توجد ملفات استيراد في السلة.")}</p> : <div className={styles.trashList}>{rows.map(row => { const reason = IMPORT_REVIEW_REASONS.find(option => option.id === row.reason); return <article className={styles.trashRow} key={row.id}><div><strong dir="auto">{row.full_name || row.ref}</strong><small dir="auto">{row.ref} · {row.phone}<br />{row.archived_by} · {dateTime(row.archived_at)} · {row.documents} {t("documents retained", "وثائق محفوظة")}{reason && <><br />{t(reason.en, reason.ar)}</>}</small></div><ActionButton type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => restore(row.id)}>{busy === row.id ? t("Restoring…", "جارٍ الاستعادة…") : t("Restore file", "استعادة الملف")}</ActionButton></article>; })}</div>}
  </section>;
}
