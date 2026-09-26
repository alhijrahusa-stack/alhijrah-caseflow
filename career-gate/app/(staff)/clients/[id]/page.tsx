import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityTimeline } from "@/components/client/ActivityTimeline";
import { AppointmentPanel } from "@/components/client/AppointmentPanel";
import { ClientTabs } from "@/components/client/ClientTabs";
import { DocumentsPanel } from "@/components/client/DocumentsPanel";
import { PaymentPanel } from "@/components/client/PaymentPanel";
import { WorkflowPanel } from "@/components/client/WorkflowPanel";
import { StageBadge } from "@/components/StageBadge";
import { Card } from "@/components/ui/Card";
import { findCity, findJob, findSite, shiftLabel } from "@/lib/catalog";
import { dateTime, money, phone } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { ActivityRow, AppointmentRow, ClientRow, DocumentRow, PaymentRow } from "@/lib/types";

export const metadata: Metadata = { title: "Client" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = await createClient();

  const { data: client } = await db.from("clients").select("*").eq("id", id).maybeSingle<ClientRow>();
  if (!client) notFound();

  const [appts, docs, pays, acts] = await Promise.all([
    db.from("appointments").select("id, kind, starts_at, ends_at, location, status, notes")
      .eq("client_id", id).order("starts_at", { ascending: false }),
    db.from("documents").select("id, kind, file_name, mime_type, size_bytes, verified, ocr_status, ocr_text, created_at")
      .eq("client_id", id).order("created_at", { ascending: false }),
    db.from("payments").select("id, amount_cents, method, status, reference, received_at")
      .eq("client_id", id).order("received_at", { ascending: false }),
    db.from("activity").select("id, type, summary, created_at")
      .eq("client_id", id).order("created_at", { ascending: false }).limit(200),
  ]);

  const job = findJob(client.city, client.site_code, client.job_code);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{client.first_name} {client.last_name}</h1>
        <span className="font-mono text-sm text-slate-500">{client.ref}</span>
        <StageBadge stage={client.stage} />
      </div>

      <Card>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Phone" value={`${phone(client.phone)}${client.whatsapp_consent ? " · WhatsApp ✓" : ""}`} />
          <Field label="Email" value={client.email ?? "—"} />
          <Field label="Language" value={client.preferred_language.toUpperCase()} />
          <Field label="Applied" value={dateTime(client.created_at)} />
          <Field label="City" value={findCity(client.city)?.name ?? client.city} />
          <Field label="Site" value={findSite(client.city, client.site_code)?.name ?? client.site_code} />
          <Field label="Job" value={job?.title ?? client.job_code} />
          <Field label="Pay expectation" value={client.pay_expectation_cents != null ? `${money(client.pay_expectation_cents)}/hr` : "—"} />
          <Field label="Primary shift" value={shiftLabel(client.primary_shift)} />
          <Field label="Backup shift" value={shiftLabel(client.backup_shift)} />
        </dl>
      </Card>

      <ClientTabs
        tabs={[
          { key: "workflow", label: "Workflow", content: <WorkflowPanel clientId={id} stage={client.stage} /> },
          { key: "appointments", label: `Appointments (${appts.data?.length ?? 0})`, content: <AppointmentPanel clientId={id} appointments={(appts.data ?? []) as AppointmentRow[]} /> },
          { key: "documents", label: `Documents (${docs.data?.length ?? 0})`, content: <DocumentsPanel clientId={id} documents={(docs.data ?? []) as DocumentRow[]} /> },
          { key: "payments", label: "Payments", content: <PaymentPanel clientId={id} payments={(pays.data ?? []) as PaymentRow[]} /> },
          { key: "activity", label: "Activity", content: <ActivityTimeline activity={(acts.data ?? []) as ActivityRow[]} /> },
        ]}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
