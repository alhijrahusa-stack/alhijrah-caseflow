import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusLookup } from "@/components/StatusLookup";

export const metadata: Metadata = { title: "Check status", robots: { index: false } };

export default function StatusLookupPage() {
  return (
    <>
      <div className="mb-6"><p className="text-xs font-bold tracking-[.18em] text-[#E6C585]">SECURE CLIENT ACCESS · بوابة العملاء</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Check your status</h1><p className="mt-2 text-sm leading-6 text-slate-300">Track your application securely, review your appointment, and manage requests. <span lang="ar" dir="rtl" className="block">تابع حالة ملفك ومواعيدك بأمان وسهولة.</span></p></div>
      <Suspense><StatusLookup /></Suspense>
    </>
  );
}
