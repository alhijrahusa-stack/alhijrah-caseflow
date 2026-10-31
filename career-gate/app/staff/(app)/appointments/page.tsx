import Link from "next/link";
import { redirect } from "next/navigation";
import { MobileAppointmentCards } from "@/components/staff/MobileAppointmentCards";
import { EmptyState } from "@/components/ui/EmptyState";
import { getStaffSession } from "@/lib/auth";
import { appointmentPage } from "@/lib/queries";

const VIEWS = [["active", "Active Cases"], ["upcoming", "Upcoming"], ["next_2h", "Next 2 Hours"], ["today", "Today"], ["past", "Past"], ["all", "All"]] as const;
const PAGE_SIZE = 25;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const params = await searchParams;
  const view = VIEWS.some(([key]) => key === params.view) ? params.view! : "active";
  const requestedPage = Number(params.page ?? "1");
  const q = params.q?.trim().slice(0, 100) ?? "";
  const result = await appointmentPage(session, view, requestedPage, PAGE_SIZE, q);
  const { page, pages, total } = result;
  const rows = JSON.parse(JSON.stringify(result.rows));
  const href = (nextView: string, nextPage = 1) =>
    `/staff/appointments?view=${encodeURIComponent(nextView)}&page=${nextPage}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="ops-page min-w-0 space-y-5">
      <header className="ops-hero flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="ops-kicker">CAREER GATE · FIELD APPOINTMENTS</p>
          <h1>Appointments <span className="text-amber-300">/ المواعيد</span></h1>
          <p>{total} matching appointments · Office time: America/Detroit · Page {page} of {pages}</p>
        </div>
        <Link href="/staff/clients" className="ops-primary-button">Open client registry</Link>
      </header>
      {view==="past"&&<p className="text-xs text-slate-400">سجل المواعيد السابق محفوظ للمراجعة، ويشمل الملفات التي غادرت قائمة العمل النشطة.</p>}
      <form method="get" role="search" className="ops-glass-card flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <label className="min-w-0 flex-1 text-xs font-semibold text-slate-400">
          Find appointment
          <input type="search" name="q" defaultValue={q} maxLength={100} placeholder="Candidate name, case number or phone" aria-label="Search appointments" className="input mt-2 w-full min-w-0" />
        </label>
        <button type="submit" className="ops-primary-button">Search / بحث</button>
        {q && <Link href={href(view).split("&q=")[0]} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm text-slate-300">Clear</Link>}
      </form>
      <nav className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6" aria-label="Appointment views">
        {VIEWS.map(([key, label]) => (
          <Link key={key} href={href(key)} aria-current={key === view ? "page" : undefined}
            className={key === view
              ? "flex min-h-12 items-center justify-center rounded-2xl border border-amber-300/50 bg-gradient-to-br from-amber-300/20 to-amber-300/5 px-3 py-2 font-semibold text-amber-100 shadow-[inset_0_1px_rgba(255,255,255,.2)]"
              : "flex min-h-12 items-center justify-center rounded-2xl border border-white/15 bg-white/[.035] px-3 py-2 text-slate-200 backdrop-blur-xl transition duration-200 hover:-translate-y-px hover:border-amber-300/35 hover:bg-white/10"}>
            {label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="No appointments in this view" text="Search another name or book an available slot from the client file." action={<Link href="/staff/clients" className="text-sm text-amber-200 hover:underline">Find a client</Link>} />
      ) : <MobileAppointmentCards appointments={rows} />}
      {pages > 1 && <nav aria-label="Appointment pages" className="flex items-center justify-between gap-3 text-sm text-slate-300">
        {page > 1 ? <Link href={href(view, page - 1)} className="inline-flex min-h-11 items-center rounded-xl border border-white/20 px-4">Previous</Link> : <span />}
        <span className="tabular-nums">Page {page} / {pages}</span>
        {page < pages ? <Link href={href(view, page + 1)} className="inline-flex min-h-11 items-center rounded-xl border border-amber-300/40 px-4 text-amber-200">Next</Link> : <span />}
      </nav>}
    </div>
  );
}
