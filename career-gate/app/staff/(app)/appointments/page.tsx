import { StaffText } from "@/components/staff/StaffLanguage";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MobileAppointmentCards } from "@/components/staff/MobileAppointmentCards";
import { StaffEmptyState, StaffInput, StaffNav } from "@/components/staff/StaffPageLabels";
import { getStaffSession, withStaff } from "@/lib/auth";
import { appointmentPage } from "@/lib/queries";

const VIEWS = [["active", "Active Cases", "الملفات النشطة"], ["upcoming", "Upcoming", "القادمة"], ["next_2h", "Next 2 Hours", "خلال ساعتين"], ["today", "Today", "اليوم"], ["past", "Past", "السابقة"], ["all", "All", "الكل"]] as const;
const PAGE_SIZE = 25;

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string; q?: string }> }) {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  const params = await searchParams;
  const view = VIEWS.some(([key]) => key === params.view) ? params.view! : "active";
  const requestedPage = Number(params.page ?? "1");
  const q = params.q?.trim().slice(0, 100) ?? "";
  const [result, waiting] = await Promise.all([
    appointmentPage(session, view, requestedPage, PAGE_SIZE, q),
    view === "active" ? withStaff(session, tx => tx`select c.id,c.ref,c.full_name from clients c
      where c.deleted_at is null and c.current_status='appointment_scheduled'
        and not exists(select 1 from appointments a where a.client_id=c.id and a.appointment_kind='employment_interview'
          and a.status in ('scheduled','confirmed','rescheduled','attended')
          and not exists(select 1 from appointment_outcomes o where o.appointment_id=a.id))
        and (${q}='' or strpos(lower(c.full_name),lower(${q}))>0 or strpos(lower(c.ref),lower(${q}))>0 or strpos(c.phone,${q})>0)
      order by c.updated_at desc,c.id limit 20`) : Promise.resolve([]),
  ]);
  const { page, pages, total } = result;
  const rows = JSON.parse(JSON.stringify(result.rows));
  const href = (nextView: string, nextPage = 1) =>
    `/staff/appointments?view=${encodeURIComponent(nextView)}&page=${nextPage}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="ops-page min-w-0 space-y-5">
      <header className="ops-hero flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="ops-kicker"><StaffText en="CAREER GATE · FIELD APPOINTMENTS" ar="CAREER GATE · المواعيد الميدانية"/></p>
          <h1><StaffText en="Appointments" ar="المواعيد"/></h1>
          <p>{total} <StaffText en="matching appointments · Office time: America/Detroit · Page" ar="موعد مطابق · توقيت المكتب: America/Detroit · الصفحة"/> {page} <StaffText en="of" ar="من"/> {pages}</p>
        </div>
        <Link href="/staff/clients" className="ops-primary-button"><StaffText en="Open client registry" ar="فتح سجل العملاء"/></Link>
      </header>
      {view==="past"&&<p className="text-xs text-slate-400"><StaffText en="Past appointments are retained for review, including files that have left the active workflow." ar="سجل المواعيد السابق محفوظ للمراجعة، ويشمل الملفات التي غادرت قائمة العمل النشطة."/></p>}
      <form method="get" role="search" className="ops-glass-card flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <label className="min-w-0 flex-1 text-xs font-semibold text-slate-400">
          <StaffText en="Find appointment" ar="البحث عن موعد"/>
          <StaffInput type="search" name="q" defaultValue={q} maxLength={100} placeholder="Candidate name, case number or phone" placeholderAr="اسم المرشح أو رقم الملف أو الهاتف" aria-label="Search appointments" ariaLabelAr="البحث في المواعيد" className="input mt-2 w-full min-w-0" />
        </label>
        <button type="submit" className="ops-primary-button"><StaffText en="Search" ar="بحث"/></button>
        {q && <Link href={href(view).split("&q=")[0]} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm text-slate-300"><StaffText en="Clear" ar="مسح"/></Link>}
      </form>
      <StaffNav className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6" aria-label="Appointment views" ariaLabelAr="عروض المواعيد">
        {VIEWS.map(([key, label, labelAr]) => (
          <Link key={key} href={href(key)} aria-current={key === view ? "page" : undefined}
            className={key === view
              ? "flex min-h-12 items-center justify-center rounded-2xl border border-amber-300/50 bg-gradient-to-br from-amber-300/20 to-amber-300/5 px-3 py-2 font-semibold text-amber-100 shadow-[inset_0_1px_rgba(255,255,255,.2)]"
              : "flex min-h-12 items-center justify-center rounded-2xl border border-white/15 bg-white/[.035] px-3 py-2 text-slate-200 backdrop-blur-xl transition duration-200 hover:-translate-y-px hover:border-amber-300/35 hover:bg-white/10"}>
            <StaffText en={label} ar={labelAr}/>
          </Link>
        ))}
      </StaffNav>
      {waiting.length > 0 && <section className="ops-glass-card space-y-3" aria-label="Workflow files awaiting booking">
        <h2 className="font-semibold text-amber-100"><StaffText en="Awaiting interview booking" ar="بانتظار حجز المقابلة"/></h2>
        <div className="grid gap-2 sm:grid-cols-2">{waiting.map(client => <Link key={String(client.id)} href={`/staff/client/${client.id}`} className="cg-command-button flex justify-between gap-3"><bdi>{String(client.full_name)}</bdi><span className="font-mono text-xs">{String(client.ref)} ↗</span></Link>)}</div>
        <Link href="/staff/clients?stage=appointments" className="text-sm text-cyan-200"><StaffText en="View all files in Appointments ↗" ar="عرض جميع ملفات مرحلة المقابلات ↗"/></Link>
      </section>}
      {rows.length === 0 ? (
        <StaffEmptyState title="No appointments in this view" titleAr="لا توجد مواعيد في هذا العرض" text="Search another name or book an available slot from the client file." textAr="ابحث باسم آخر أو احجز موعداً متاحاً من ملف العميل." action={<Link href="/staff/clients" className="text-sm text-amber-200 hover:underline"><StaffText en="Find a client" ar="البحث عن عميل"/></Link>} />
      ) : <MobileAppointmentCards appointments={rows} />}
      {pages > 1 && <StaffNav aria-label="Appointment pages" ariaLabelAr="صفحات المواعيد" className="flex items-center justify-between gap-3 text-sm text-slate-300">
        {page > 1 ? <Link href={href(view, page - 1)} className="inline-flex min-h-11 items-center rounded-xl border border-white/20 px-4"><StaffText en="Previous" ar="السابق"/></Link> : <span />}
        <span className="tabular-nums"><StaffText en="Page" ar="الصفحة"/> {page} / {pages}</span>
        {page < pages ? <Link href={href(view, page + 1)} className="inline-flex min-h-11 items-center rounded-xl border border-amber-300/40 px-4 text-amber-200"><StaffText en="Next" ar="التالي"/></Link> : <span />}
      </StaffNav>}
    </div>
  );
}
