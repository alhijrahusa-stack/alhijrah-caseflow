import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OFFICE } from "@/lib/office";
import { accessKey, cookieValue, STAFF_COOKIE, verifyKey } from "@/lib/staff-access";

export const metadata: Metadata = { title: "Office access" };

function safeNext(next: unknown) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/staff") ? n : "/staff";
}

async function enter(form: FormData) {
  "use server";
  const next = safeNext(form.get("next"));
  const key = String(form.get("key") ?? "");
  if (!(await verifyKey(key))) redirect(`/staff-access?error=1&next=${encodeURIComponent(next)}`);
  const jar = await cookies();
  jar.set(STAFF_COOKIE, await cookieValue(accessKey()!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect(next);
}

export default async function StaffAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const configured = Boolean(accessKey());
  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <p className="text-sm font-semibold text-brand-700">{OFFICE.product}</p>
      <h1 className="mb-6 text-xl font-semibold">Office access</h1>
      {configured ? (
        <form action={enter} className="space-y-4">
          <input type="hidden" name="next" value={safeNext(next)} />
          <div>
            <label className="label" htmlFor="key">Office access key</label>
            <input id="key" name="key" type="password" className="input" autoComplete="current-password" required />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">That key is not correct.</p>}
          <button className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">Enter</button>
        </form>
      ) : (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          STAFF_ACCESS_KEY is not configured on the server, so the office workspace is closed.
        </p>
      )}
    </main>
  );
}
