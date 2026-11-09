"use client";

import { ActionButton } from "@/components/ui/ActionButton";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStaff } from "@/components/staff/StaffContext";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

type AssistantComponent = typeof import("@/components/staff/OperationalAssistant").OperationalAssistant;

/** Keep the chat transport and SDK out of the staff workspace's initial bundle. */
export function DeferredOperationalAssistant({ enabled }: { enabled: boolean }) {
  const { me } = useStaff();
  return <AssistantLauncher key={me.id} enabled={enabled}/>;
}

function AssistantLauncher({ enabled }: { enabled: boolean }) {
  const { t } = useStaffLanguage();
  const [Assistant, setAssistant] = useState<AssistantComponent | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);

  const load = useCallback(() => {
    if (!enabled || Assistant || inFlight.current) return;
    inFlight.current = true; setLoading(true); setFailed(false);
    void import("@/components/staff/OperationalAssistant").then(module => {
      if (mounted.current) setAssistant(() => module.OperationalAssistant);
    }).catch(() => {
      if (mounted.current) setFailed(true);
    }).finally(() => {
      inFlight.current = false;
      if (mounted.current) setLoading(false);
    });
  }, [enabled, Assistant]);

  useEffect(() => {
    mounted.current = true;
    if (enabled) window.addEventListener("career-gate:open-assistant", load);
    return () => {
      mounted.current = false;
      window.removeEventListener("career-gate:open-assistant", load);
    };
  }, [enabled, load]);

  if (!enabled) return null;
  // The event that loads the module happened before its listener was mounted.
  // initialOpen preserves that first click. Keep it mounted when closed so chat
  // history and the unsent draft survive navigation within the staff shell.
  if (Assistant) return <Assistant enabled initialOpen/>;
  if (!loading && !failed) return null;
  return <div role={failed ? "alert" : "status"} className="royal-sync-toast">
    {failed ? t("The assistant could not load. Your workspace is still available.", "تعذر تحميل المساعد. مساحة العمل ما زالت متاحة.") : t("Opening assistant…", "جارٍ فتح المساعد…")}
    {failed && <ActionButton type="button" className="cg-command-button" onClick={load}>{t("Retry", "إعادة المحاولة")}</ActionButton>}
  </div>;
}
