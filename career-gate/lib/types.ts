import type { Stage } from "@/lib/workflow/engine";

export type ClientRow = {
  id: string;
  ref: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  preferred_language: string;
  whatsapp_consent: boolean;
  city: string;
  site_code: string;
  job_code: string;
  primary_shift: string;
  backup_shift: string | null;
  pay_expectation_cents: number | null;
  stage: Stage;
  created_at: string;
};

export type AppointmentRow = {
  id: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  status: "scheduled" | "completed" | "no_show" | "cancelled";
  notes: string | null;
};

export type DocumentRow = {
  id: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  verified: boolean;
  ocr_status: "none" | "pending" | "done" | "failed";
  ocr_text: string | null;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  amount_cents: number;
  method: string;
  status: "received" | "refunded" | "void";
  reference: string | null;
  received_at: string;
};

export type ActivityRow = {
  id: number;
  type: string;
  summary: string;
  created_at: string;
};
