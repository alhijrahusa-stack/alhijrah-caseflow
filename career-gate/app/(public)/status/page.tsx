import type { Metadata } from "next";
import { Suspense } from "react";
import { StatusLookup } from "@/components/StatusLookup";

export const metadata: Metadata = { title: "Check status", robots: { index: false } };

export default function StatusLookupPage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Check your status</h1>
      <Suspense><StatusLookup /></Suspense>
    </>
  );
}
