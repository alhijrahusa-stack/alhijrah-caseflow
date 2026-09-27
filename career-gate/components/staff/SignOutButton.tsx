"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button type="button" className="text-slate-500 hover:text-slate-900"
      onClick={async () => {
        await fetch("/api/staff/auth/logout", { method: "POST" });
        router.push("/staff/login");
        router.refresh();
      }}>
      Sign out
    </button>
  );
}
