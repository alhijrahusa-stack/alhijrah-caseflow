import { OFFICE } from "@/lib/office";

export function OfficeContact({ className = "" }: { className?: string }) {
  const wa = OFFICE.whatsapp.replace(/\D/g, "");
  return (
    <div className={`text-sm text-slate-600 ${className}`}>
      <p className="font-medium text-slate-800">{OFFICE.company} — {OFFICE.product}</p>
      <p>
        Email: <a className="text-brand-700 hover:underline" href={`mailto:${OFFICE.email}`}>{OFFICE.email}</a>
        {" · "}Phone: <a className="text-brand-700 hover:underline" href={`tel:+1${OFFICE.phone.replace(/\D/g, "")}`}>{OFFICE.phone}</a>
        {" · "}WhatsApp: <a className="text-brand-700 hover:underline" href={`https://wa.me/1${wa}`}>{OFFICE.whatsapp}</a>
      </p>
    </div>
  );
}
