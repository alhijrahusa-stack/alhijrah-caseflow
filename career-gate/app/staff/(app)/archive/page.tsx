import Link from "next/link";
import { redirect } from "next/navigation";
import { ArchiveRestoreButton } from "@/components/staff/ArchiveRestoreButton";
import { getStaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type ArchivedClient = {
  id: string;
  ref: string;
  full_name: string;
  email: string | null;
  phone: string;
  deleted_at: string;
  delete_reason: string | null;
  deleted_by_name: string | null;
  retained_documents: number;
};

export default async function ArchivePage() {
  const session = await getStaffSession();
  if (!session) redirect("/staff/login");
  if (session.staff.role !== "admin" && session.staff.role !== "manager") redirect("/staff");

  const rows = await sql()<ArchivedClient[]>`
    select
      c.id,
      c.ref,
      c.full_name,
      c.email,
      c.phone,
      c.deleted_at,
      c.delete_reason,
      s.display_name as deleted_by_name,
      count(d.id)::int as retained_documents
    from clients c
    left join staff s on s.id = c.deleted_by
    left join documents d on d.client_id = c.id
    where c.deleted_at is not null
    group by c.id, s.display_name
    order by c.deleted_at desc`;

  const retainedDocuments = rows.reduce((total, row) => total + Number(row.retained_documents ?? 0), 0);

  return (
    <div className="ops-page space-y-4">
      <header className="ops-hero archive-hero">
        <div>
          <p className="ops-kicker">CAREER GATE · CONTROLLED ARCHIVE</p>
          <h1>Archive</h1>
          <p>Recoverable operational records retained without destructive deletion.</p>
        </div>
        <div className="archive-summary-grid" aria-label="Archive summary">
          <div><span>Archived Clients</span><strong>{rows.length}</strong></div>
          <div><span>Retained Documents</span><strong>{retainedDocuments}</strong></div>
        </div>
      </header>

      <section className="archive-section ops-glass-card p-0">
        <div className="archive-section-head">
          <div><p className="ops-kicker">CLIENT RECORDS</p><h2>Archived Clients</h2></div>
          <span>{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No archived clients.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table min-w-[980px]">
              <thead><tr><th>Reference</th><th>Client</th><th>Archived</th><th>Reason</th><th>Documents Retained</th><th>Archived By</th><th>Action</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono text-cyan-300">{row.ref}</td>
                    <td><strong className="block text-slate-100">{row.full_name}</strong><span className="text-xs text-slate-500">{row.email ?? row.phone}</span></td>
                    <td className="whitespace-nowrap">{dateTime(row.deleted_at)}</td>
                    <td className="max-w-xs text-slate-400">{row.delete_reason ?? "—"}</td>
                    <td><span className="archive-document-count">{row.retained_documents}</span></td>
                    <td>{row.deleted_by_name ?? "—"}</td>
                    <td><ArchiveRestoreButton clientId={row.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="archive-section ops-glass-card">
        <div className="archive-section-head px-0 pt-0">
          <div><p className="ops-kicker">DOCUMENT RETENTION</p><h2>Documents Retained With Archived Clients</h2></div>
          <span>{retainedDocuments}</span>
        </div>
        <p className="text-sm text-slate-400">Archived client files retain their documents and audit history. Restoring the client restores the operational file without recreating records.</p>
        <Link href="/staff/clients" className="mt-4 inline-flex text-sm font-semibold text-cyan-300 hover:text-cyan-200">Return to Clients</Link>
      </section>
    </div>
  );
}
