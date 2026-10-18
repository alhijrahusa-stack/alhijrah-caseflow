import Image from "next/image";
import { OfficeContact } from "@/components/OfficeContact";
import { OFFICE } from "@/lib/office";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="cg-public relative isolate min-h-[100dvh] overflow-x-hidden bg-[#05112B] text-slate-100">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_8%_0%,rgba(19,89,197,.31),transparent_49%),radial-gradient(ellipse_at_98%_45%,rgba(24,84,178,.20),transparent_47%),linear-gradient(155deg,#051129_0%,#08214B_52%,#06112B_100%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 bg-[linear-gradient(122deg,transparent_35%,rgba(229,188,110,.10)_60%,transparent_82%)]" />
      <div className="mx-auto w-full max-w-[1100px] px-3 py-4 sm:px-6 sm:py-8 lg:px-8">
        <header className="cg-lux-card relative mb-5 overflow-hidden rounded-[24px] px-4 py-4 sm:mb-6 sm:rounded-[28px] sm:px-6 sm:py-5">
          <div className="relative z-10 flex items-center gap-3 sm:gap-5">
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#E8C785]/65 bg-white p-2 shadow-[0_6px_24px_rgba(0,0,0,.28)] sm:h-[90px] sm:w-[90px]">
              <Image src="/brand/career-gate.webp" alt="Career Gate official logo" width={96} height={96} className="h-full w-full object-contain" priority />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold uppercase tracking-[.21em] text-[#F0C982] sm:text-[11px]">Career Gate · Client Portal</p>
              <p className="mt-1 text-[clamp(1.28rem,4.8vw,2.25rem)] font-bold leading-tight tracking-[-.035em] text-white">{OFFICE.product}</p>
              <p lang="ar" dir="rtl" className="mt-1 w-fit max-w-full text-[clamp(.75rem,3.1vw,1.05rem)] font-semibold leading-relaxed text-[#F0CA8A]">بوابة التوظيف عبر مكتب الهجرة</p>
              <p className="mt-1 hidden text-xs font-medium tracking-[.025em] text-slate-300 sm:block">{OFFICE.company}</p>
            </div>
            <div className="hidden self-start rounded-full border border-sky-300/25 bg-sky-300/[.07] px-3 py-1.5 text-[11px] font-semibold tracking-wide text-[#DDEBFF] md:block">Secure Client Portal</div>
          </div>
        </header>
        <main className="min-w-0">{children}</main>
        <footer className="cg-lux-card relative mt-5 overflow-hidden rounded-[23px] p-4 sm:mt-6 sm:p-6">
          <div className="relative z-10">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="cg-lux-icon mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg">✦</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold tracking-[-.01em] text-[#F1D096] sm:text-base">Contact the Office <span lang="ar" dir="rtl" className="ml-1 font-semibold text-[#F1D096]">تواصل معنا</span></p>
                <p className="mt-1 text-xs font-medium text-slate-300">{OFFICE.company}</p>
              </div>
            </div>
            <OfficeContact theme="dark" showCompany={false} className="mt-3" />
            <p className="mt-4 border-t border-white/10 pt-3 text-xs leading-6 text-slate-300">
              Career Gate is operated by ALHIJRAH SERVICES LLC. It is not affiliated with or operated by Amazon. Hiring decisions are made by the employer.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
