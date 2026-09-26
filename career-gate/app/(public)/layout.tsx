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
      </footer>
    </div>
  );
}
