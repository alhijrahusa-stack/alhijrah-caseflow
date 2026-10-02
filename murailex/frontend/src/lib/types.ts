export type User = { id: string; email: string; display_name: string; role: string; is_active: boolean };

export type Recording = {
  id: string;
  title: string;
  source: string;
  original_filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  uploaded_at: string;
  duration_ms: number | null;
  status: string;
  status_detail: string | null;
  language_locale: string | null;
  recording_type: string | null;
  expected_terms: string[] | null;
  expected_speakers: number | null;
  open_disputes?: number;
  storage_version_id?: string | null;
  media_info?: Record<string, unknown> | null;
};

export type Provenance = Record<string, unknown>;

export type Item = {
  kind: "word" | "marker" | "dispute";
  text: string;
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  risks: string[];
  source: string;
  provenance: Provenance[];
  dispute_id?: string;
  evidence_state?: "CONFIRMED" | "LOW_CONFIDENCE" | "UNINTELLIGIBLE" | "DISPUTED" | "SILENCE";
};

export type Segment = { id: string; speaker: string | null; start_ms: number; end_ms: number; items: Item[] };

export type SpeakerInfo = { label: string; verified_name: string | null; verified_by: string | null; verified_at: string | null };

export type Content = {
  schema: string;
  title: string;
  controlling_source: string;
  recording: { id: string; sha256: string; filename: string; duration_ms: number };
  speakers: Record<string, SpeakerInfo>;
  segments: Segment[];
  method: Record<string, unknown>;
};

export type Revision = {
  id: string;
  number: number;
  status: "draft" | "locked";
  review_state: "unreviewed" | "in_review" | "reviewed";
  sha256: string | null;
  parent_id: string | null;
  created_at: string;
  locked_at: string | null;
  locked_by: string | null;
  content?: Content;
};

export type Summary = {
  id: string;
  recording_id: string;
  transcript_revision_id: string;
  transcript_sha256: string | null;
  summary_type: "neutral" | "defense" | "prosecution";
  summary_revision: number;
  status: "draft" | "locked";
  content: {
    type: string;
    key_passages: Array<{ text: string; speaker: string; start_ms: number }>;
    critical_moments: Array<{ text: string; speaker: string; start_ms: number }>;
    total_speakers: number;
    unresolved_disputes: number;
  };
  generated_at: string;
  generation_model: string;
  created_at: string;
};

export type Candidate = {
  provider: string;
  model: string;
  run_id: string;
  role: string;
  text: string;
  tokens: { text: string; start_ms: number; end_ms: number; confidence: number | null }[];
  mean_confidence: number | null;
  min_confidence: number | null;
  agrees_with: string[];
};

export type Dispute = {
  id: string;
  ordinal: number;
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  reasons: string[];
  candidates: Candidate[];
  status: "open" | "resolved";
  resolution: Record<string, string> | null;
  resolved_at: string | null;
};

export type ProviderRun = {
  id: string;
  provider: string;
  model: string;
  role: string;
  scope: string;
  status: string;
  attempt: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  token_count: number | null;
};

export type Translation = {
  id: string;
  mode: string;
  status: string;
  error: string | null;
  sha256: string | null;
  provider: string;
  model: string;
  created_at: string;
  segments:
    | { segment_id: string; start_ms: number; end_ms: number; speaker: string | null; speaker_label: string; source_text: string; translation: string }[]
    | null;
};

export type ExportInfo = { id: string; format: string; filename: string; sha256: string; bytes: number; download_url: string; created_at?: string };

