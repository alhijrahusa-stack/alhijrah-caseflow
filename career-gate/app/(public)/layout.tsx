import Image from "next/image";
import { OfficeContact } from "@/components/OfficeContact";
import { OFFICE } from "@/lib/office";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate min-h-[100dvh] overflow-x-hidden bg-[#06152f] text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_12%_8%,rgba(46,105,220,.30),transparent_48%),radial-gradient(ellipse_at_90%_75%,rgba(26,74,160,.20),transparent_50%),linear-gradient(150deg,#06152f,#0a2050_54%,#06142d)]" />
      <div className="mx-auto w-full max-w-[860px] px-4 py-6 sm:px-7 sm:py-10">
        <header className="mb-7 overflow-hidden rounded-[26px] border border-white/20 bg-white/[.08] p-4 shadow-[0_18px_55px_rgba(0,0,0,.25)] backdrop-blur-xl sm:p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-[78px] w-[78px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#C5A059]/50 bg-white p-2 shadow-[0_8px_28px_rgba(0,0,0,.20)] sm:h-24 sm:w-24">
              <Image src="/brand/career-gate.webp" alt="Career Gate official logo" width={96} height={96} className="h-full w-full object-contain" priority />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold tracking-[.22em] text-[#E6C585]">CAREER GATE · CLIENT PORTAL</p>
              <p className="mt-1 text-xl font-extrabold tracking-wide text-white sm:text-2xl">{OFFICE.product}</p>
              <p lang="ar" dir="rtl" className="mt-1 text-sm font-semibold text-[#E6C585]">بوابة التوظيف عبر مكتب الهجرة</p>
              <p className="mt-1 break-words text-[10px] leading-4 text-slate-300 sm:text-xs">{OFFICE.company}</p>
            </div>
          </div>
        </header>
        <main className="min-w-0">{children}</main>
        <footer className="mt-8 rounded-2xl border border-white/15 bg-white/[.07] p-5 text-slate-200 backdrop-blur-lg">
          <p className="mb-2 text-sm font-bold text-[#E6C585]">Career Gate · بوابة التوظيف</p>
          <OfficeContact theme="dark" />
          <p className="mt-4 text-xs leading-6 text-slate-300">Career Gate is operated by ALHIJRAH SERVICES LLC. It is not affiliated with or operated by Amazon. Hiring decisions are made by the employer.</p>
        </footer>
      </div>
    </div>
  );
}
