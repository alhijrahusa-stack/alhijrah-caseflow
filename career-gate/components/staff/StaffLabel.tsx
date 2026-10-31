"use client";

import { useCallback } from "react";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { arabicStaffLabel } from "@/lib/staff-ui-labels";

/** Explicit UI labels only; client-entered data stays untouched. */
export function useStaffLabel() {
  const { t } = useStaffLanguage();
  return useCallback((english: string) => t(english, arabicStaffLabel(english)), [t]);
}

export function StaffLabel({ en, ar }: { en: string; ar?: string }) {
  const { t } = useStaffLanguage();
  return t(en, ar ?? arabicStaffLabel(en));
}
