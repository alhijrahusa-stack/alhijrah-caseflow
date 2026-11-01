"use client";

import { useRouter } from "next/navigation";
import { useStaffLanguage } from "@/components/staff/StaffLanguage";
import { useToast } from "@/components/ui/Toast";

export function SignOutButton() {
  const router = useRouter();
  const { t } = useStaffLanguage();
  const toast = useToast();
  return (
    <button type="button" className="staff-sign-out text-slate-500 hover:text-slate-900" aria-label={t("Sign out", "تسجيل الخروج")} title={t("Sign out", "تسجيل الخروج")}
      onClick={async () => {
        try {
          const response = await fetch("/api/staff/auth/logout", { method: "POST" });
          if (!response.ok) throw new Error("logout_failed");
        } catch {
          toast("error", t("Could not sign out. Please try again.", "تعذر تسجيل الخروج. أعد المحاولة."));
          return;
        }
        window.dispatchEvent(new Event("career-gate:sign-out"));
        router.push("/staff/login");
        router.refresh();
      }}>
      {t("Sign out", "تسجيل الخروج")}
    </button>
  );
}
