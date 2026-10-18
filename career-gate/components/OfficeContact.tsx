import { OFFICE } from "@/lib/office";

export function OfficeContact({ className = "", theme = "light", showCompany = true }: { className?: string; theme?: "light" | "dark"; showCompany?: boolean }) {
  const wa = OFFICE.whatsapp.replace(/\D/g, "");
  const dark = theme === "dark";
  const link = dark
    ? "min-w-0 break-words font-medium text-[#D9E8FF] underline-offset-4 hover:text-white hover:underline"
    : "min-w-0 break-words font-medium text-brand-700 underline-offset-4 hover:underline";
  return (
    <div className={`text-sm ${dark ? "text-slate-200" : "text-slate-600"} ${className}`}>
      {showCompany && <p className={`font-medium ${dark ? "text-slate-200" : "text-slate-800"}`}>{OFFICE.company} — {OFFICE.product}</p>}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 leading-6">
        <span>Email: <a className={link} href={`mailto:${OFFICE.email}`}>{OFFICE.email}</a></span>
        <span>Phone: <a className={link} href={`tel:+1${OFFICE.phone.replace(/\D/g, "")}`}>{OFFICE.phone}</a></span>
        <span>WhatsApp: <a className={link} href={`https://wa.me/1${wa}`}>{OFFICE.whatsapp}</a></span>
      </div>
    </div>
  );
}
