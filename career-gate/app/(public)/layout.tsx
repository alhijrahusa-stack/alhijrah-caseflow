import { OfficeContact } from "@/components/OfficeContact";
import { OFFICE } from "@/lib/office";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[640px] px-4 py-8">
      <header className="mb-6">
        <p className="text-lg font-semibold text-brand-700">{OFFICE.product}</p>
        <p className="text-sm text-slate-500">{OFFICE.company}</p>
      </header>
      {children}
      <footer className="mt-10 border-t border-slate-200 pt-4">
        <OfficeContact />
        <p className="mt-3 text-xs text-slate-500">Career Gate is operated by ALHIJRAH SERVICES LLC. It is not affiliated with or operated by Amazon. Hiring decisions are made by the employer.</p>
      </footer>
    </div>
  );
}
