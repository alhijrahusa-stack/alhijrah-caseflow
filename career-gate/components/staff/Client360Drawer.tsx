"use client";

import dynamic from "next/dynamic";
import { memo } from "react";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

type Client = { id: string; ref: string; full_name: string };
const loadContent = () => import("@/components/staff/Client360Content").then(module => module.Client360Content);
function LoadingClient360() {
  const { t } = useStaffLanguage();
  return <p role="status" className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm text-slate-200">{t("Loading authorized client record…", "جارٍ تحميل الملف المسموح به…")}</p>;
}
const Content = dynamic(loadContent, { ssr: false, loading: LoadingClient360 });

/** Code-only intent preload: no client data is fetched until the drawer opens. */
export function preloadClient360() { void loadContent().catch(() => {}); }

/** Keep the dialog and its close control available before code or data arrives. */
export const Client360Drawer = memo(function Client360Drawer({ client, onClose }: { client: Client; onClose: () => void }) {
  const { t } = useStaffLanguage();
  return <GlassReviewDialog title={`Client 360: ${client.full_name}`} drawer closeLabel={t("Close Client 360", "إغلاق ملف العميل")} onClose={onClose}>
    <Content client={client}/>
  </GlassReviewDialog>;
});
