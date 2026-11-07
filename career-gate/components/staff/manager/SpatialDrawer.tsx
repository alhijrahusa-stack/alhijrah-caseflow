"use client";

import type { ReactNode } from "react";
import { GlassReviewDialog } from "@/components/staff/smart/GlassReviewDialog";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import styles from "@/components/staff/ManagerTaskCenter.module.css";

/** Uses the application's shared modal stack so secured document previews nest safely. */
export function SpatialDrawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const { t } = useStaffLanguage();
  return <GlassReviewDialog title={t("Review workspace", "مساحة المراجعة")} wide onClose={onClose} closeLabel={t("Close review", "إغلاق المراجعة")}><div className={styles.drawerContent} data-testid="manager-spatial-drawer">{children}</div></GlassReviewDialog>;
}
