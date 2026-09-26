import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getStaff } from "@/lib/supabase/server";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/appointments", label: "Appointments" },
  { href: "/tasks", label: "Tasks" },
  { href: "/reports", label: "Reports" },
];

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  // Middleware only checks for a session; this also requires an active profile.
  const staff = await getStaff();
  if (!staff) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="font-semibold text-brand-700">Career Gate</Link>
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-slate-600 hover:text-slate-900">{n.label}</Link>
            ))}
          </nav>
          <form action={signOut} className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-500">{staff.profile.full_name}</span>
            <button type="submit" className="text-slate-600 hover:text-slate-900">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
