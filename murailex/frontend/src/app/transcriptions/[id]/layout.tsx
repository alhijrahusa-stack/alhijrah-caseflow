"use client";

import { useParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { api, ApiError } from "@/lib/api";
import type { Recording } from "@/lib/types";

const VALID = new Set(["ar", "ar-YE", "ar-EG", "ar-SY", "ar-LB", "ar-IQ"]);

type Detail = { recording: Recording };

export default function RecordingLayout({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const [recording, setRecording] = useState<Recording | null>(null);
  const [locale, setLocale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<Detail>(`/api/recordings/${id}`)
      .then((result) => {
        if (live) setRecording(result.recording);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);

  async function repairAndRetry() {
    if (!VALID.has(locale)) return;
    setBusy(true);
    setError(null);
    try {
      const repaired = await api<{ recording: Recording }>(`/api/recordings/${id}/locale`, {
        method: "PATCH",
        json: { language_locale: locale },
      });
      setRecording(repaired.recording);
      await api(`/api/recordings/${id}/reprocess`, { method: "POST" });
      window.location.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Locale repair failed.");
    } finally {
      setBusy(false);
    }
  }

  const requiresRepair = recording !== null && !VALID.has(recording.language_locale ?? "");

  return (
    <>
      {requiresRepair && (
        <Card tone="warn" className="mb-5 space-y-3 p-4 sm:p-5">
          <div>
            <div className="text-sm font-semibold text-fg">لغة / لهجة التسجيل مطلوبة قبل المعالجة</div>
            <div className="mt-1 text-xs text-fg-muted">Recording locale is required. The original file and SHA-256 remain unchanged.</div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              aria-label="Recording locale"
              wrapperClassName="flex-1"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
            >
              <option value="" disabled>اختر اللغة / اللهجة</option>
              <option value="ar">العربية — ar</option>
              <option value="ar-YE">العربية اليمنية — ar-YE</option>
              <option value="ar-EG">العربية المصرية — ar-EG</option>
              <option value="ar-SY">العربية السورية — ar-SY</option>
              <option value="ar-LB">العربية اللبنانية — ar-LB</option>
              <option value="ar-IQ">العربية العراقية — ar-IQ</option>
            </Select>
            <Button disabled={!VALID.has(locale) || busy} onClick={repairAndRetry}>
              {busy ? "…" : "حفظ وإعادة المعالجة"}
            </Button>
          </div>
          {error && <Notice tone="danger" role="alert">{error}</Notice>}
        </Card>
      )}
      {children}
    </>
  );
}
