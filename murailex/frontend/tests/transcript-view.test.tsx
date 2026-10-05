import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/player", () => ({ usePlayer: () => ({ timeMs: 0, seek: vi.fn(), playWindow: vi.fn() }) }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ t: (k: string) => k, lang: "ar", dir: "rtl" }) }));
vi.mock("next/link", () => ({ default: ({ children, ...rest }: { children: React.ReactNode; href: string }) => <a {...rest}>{children}</a> }));

import { TranscriptView, segmentText } from "@/components/transcript-view";
import type { Content } from "@/lib/types";

const content: Content = {
  schema: "murailex.transcript/1",
  title: "MURAILEX FORENSIC VERBATIM TRANSCRIPT",
  controlling_source: "The original audio recording is the controlling source.",
  recording: { id: "r", sha256: "x", filename: "a.wav", duration_ms: 1000 },
  speakers: { S1: { label: "[المتحدث 1]", verified_name: null, verified_by: null, verified_at: null } },
  method: {},
  segments: [
    {
      id: "seg-00001",
      speaker: "S1",
      start_ms: 0,
      end_ms: 3000,
      items: [
        { kind: "word", text: "والله", start_ms: 0, end_ms: 400, speaker: "S1", risks: [], source: "consensus", provenance: [] },
        { kind: "word", text: "okay", start_ms: 400, end_ms: 800, speaker: "S1", risks: ["code_switch"], source: "consensus", provenance: [] },
        { kind: "marker", text: "[غير مسموع]", start_ms: 800, end_ms: 1200, speaker: "S1", risks: [], source: "human", provenance: [] },
        { kind: "dispute", text: "", dispute_id: "d1", start_ms: 1200, end_ms: 2000, speaker: "S1", risks: [], source: "consensus", provenance: [] },
      ],
    },
  ],
};

describe("TranscriptView", () => {
  it("renders verbatim tokens, markers, speaker labels and unresolved disputes", () => {
    render(<TranscriptView recordingId="r" content={content} editable={false} query="" speakerFilter={null} onChanged={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "النص الكامل" }));
    expect(screen.getByText("والله")).toBeTruthy();
    expect(screen.getByText("okay")).toBeTruthy();
    expect(screen.getByText("[غير مسموع]")).toBeTruthy();
    expect(screen.getByText("[المتحدث 1]")).toBeTruthy();
    expect(screen.getByTestId("dispute-chip").getAttribute("href")).toBe("/review/r#d-d1");
    expect(screen.getByText("والله").closest("p")?.getAttribute("dir")).toBe("rtl");
  });
});

describe("unresolved spans", () => {
  it("shows what the primary engine heard, marked, instead of a gap", () => {
    const item = {
      kind: "dispute" as const,
      text: "",
      start_ms: 0,
      end_ms: 900,
      speaker: "S1",
      risks: ["money"],
      source: "consensus",
      dispute_id: "d1",
      provenance: [
        { role: "primary_asr", provider: "local_whisper", text: "خمسة آلاف" },
        { role: "verification_asr", provider: "local_whisper_verify", text: "خمسين ألف" },
      ],
    };
    const seg = { id: "s1", speaker: "S1", start_ms: 0, end_ms: 900, items: [item] };
    render(
      <TranscriptView
        recordingId="r1"
        content={{ ...content, segments: [seg] }}
        editable={false}
        query=""
        speakerFilter={null}
        onChanged={() => undefined}
      />,
    );
    const chip = screen.getAllByTestId("dispute-chip").find((c) => c.textContent?.includes("خمسة"))!;
    expect(chip.textContent).toContain("خمسة آلاف");
    expect(chip.getAttribute("href")).toContain("/review/r1");
    // the canonical text copied out never includes an unresolved reading
    expect(segmentText(seg)).toBe("");
  });
});
