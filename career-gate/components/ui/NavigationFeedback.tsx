"use client";

import { useLinkStatus } from "next/link";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";

/** A link-local update: the glass workspace does not rerender while a route loads. */
export function NavigationFeedback() {
  const { pending } = useLinkStatus();
  const { t } = useStaffLanguage();
  return <span className="cg-navigation-feedback" data-navigation-pending={pending} role="status"><span className="sr-only">{pending ? t("Opening section…", "جارٍ فتح القسم…") : ""}</span></span>;
}
