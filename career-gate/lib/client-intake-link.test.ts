import { describe, expect, it } from "vitest";
import {
  CLIENT_EDITABLE_FIELDS,
  composeIntakeSource,
  hashIntakeToken,
  intakeIdempotencyKey,
  looksLikeIntakeToken,
  mintIntakeToken,
  sameTokenHash,
} from "@/lib/client-intake-link";
import { extractDeterministicClient } from "@/lib/smart-client-local";

describe("one-time intake token", () => {
  it("mints a base64url token and stores only its SHA-256 digest", () => {
    const { token, tokenHash } = mintIntakeToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes, base64url, unpadded.
    expect(token.length).toBe(43);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashIntakeToken(token));
    // The digest must not reveal the token.
    expect(tokenHash).not.toContain(token);
  });

  it("mints a different token every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintIntakeToken().token));
    expect(seen.size).toBe(50);
  });

  it("rejects anything that is not shaped like a minted token", () => {
    expect(looksLikeIntakeToken(mintIntakeToken().token)).toBe(true);
    for (const bad of ["", "short", "../etc/passwd", "a".repeat(200), "has spaces", "semi;colon", null, 42, undefined]) {
      expect(looksLikeIntakeToken(bad), String(bad)).toBe(false);
    }
  });

  it("derives the idempotency key from the link alone, so a retry is not a new case", () => {
    const { tokenHash } = mintIntakeToken();
    expect(intakeIdempotencyKey(tokenHash)).toBe(`client-link:${tokenHash}`);
    // Stable across calls — this is what makes stale-PROCESSING recovery safe.
    expect(intakeIdempotencyKey(tokenHash)).toBe(intakeIdempotencyKey(tokenHash));
    expect(intakeIdempotencyKey(tokenHash).length).toBeGreaterThanOrEqual(8);
    expect(intakeIdempotencyKey(tokenHash).length).toBeLessThanOrEqual(200);
  });

  it("compares digests without leaking length by early exit", () => {
    const a = hashIntakeToken("one");
    expect(sameTokenHash(a, a)).toBe(true);
    expect(sameTokenHash(a, hashIntakeToken("two"))).toBe(false);
    expect(sameTokenHash(a, "short")).toBe(false);
  });
});

describe("client corrections take precedence over the detected source", () => {
  const SOURCE = [
    "Sara Al Amin",
    "phone 313-555-0144",
    "email sara.detected@example.com",
    "28772 Goodson St",
    "Detroit MI 48212",
  ].join("\n");

  it("leaves the source untouched when the client changed nothing", () => {
    expect(composeIntakeSource(SOURCE, {})).toBe(SOURCE);
  });

  it("writes each correction as a canonical labelled line ahead of the source", () => {
    const composed = composeIntakeSource(SOURCE, { email: "sara.corrected@example.com", city: "Dearborn" });
    expect(composed.startsWith("Email: sara.corrected@example.com\nCity: Dearborn\n\n")).toBe(true);
    // The client's original text is preserved verbatim after the corrections.
    expect(composed.endsWith(SOURCE)).toBe(true);
  });

  // The decisive test: the existing deterministic parser must read the
  // correction, not the value it would otherwise have detected.
  it("is read back by the existing parser as the corrected value", () => {
    const composed = composeIntakeSource(SOURCE, {
      email: "sara.corrected@example.com",
      city: "Dearborn",
      phone: "3135550199",
    });
    const parsed = extractDeterministicClient(composed);
    expect(parsed.row.email).toBe("sara.corrected@example.com");
    expect(parsed.row.city).toBe("Dearborn");
    expect(parsed.row.phone).toBe("3135550199");
    // A field the client did not touch still comes from the source text.
    expect(String(parsed.row.state)).toBe("MI");
  });

  it("round-trips every editable field through the parser", () => {
    const edits = {
      full_name: "QA Synthetic Intake Client",
      phone: "3135550101",
      email: "qa.intake@example.com",
      date_of_birth: "1990-01-15",
      street: "1 Main St",
      city: "Detroit",
      state: "MI",
      zip: "48201",
      preferred_language: "Arabic",
      english_proficiency: "GOOD",
    } as const;
    const parsed = extractDeterministicClient(composeIntakeSource("", edits));
    expect(parsed.row.full_name).toBe(edits.full_name);
    expect(parsed.row.phone).toBe(edits.phone);
    expect(parsed.row.email).toBe(edits.email);
    expect(parsed.row.date_of_birth).toBe("1990-01-15");
    expect(parsed.row.street).toBe(edits.street);
    expect(parsed.row.city).toBe(edits.city);
    expect(parsed.row.state).toBe("MI");
    expect(parsed.row.zip).toBe(edits.zip);
    expect(String(parsed.row.preferred_language ?? "")).not.toBe("");
    expect(String(parsed.row.english_proficiency ?? "")).not.toBe("");
  });

  it("cannot be used to forge an extra labelled line", () => {
    // A newline inside a value would otherwise inject a second canonical line.
    // It is flattened, so each correction contributes exactly one line.
    const composed = composeIntakeSource("", { full_name: "Mallory\nPhone: 3135559999" });
    expect(composed.split("\n")).toHaveLength(1);
    expect(composed.startsWith("Full Name: ")).toBe(true);

    // And with several corrections, the count of composed lines is exactly the
    // count of non-empty corrections — never more.
    const many = composeIntakeSource("", {
      full_name: "A\nB\nC",
      city: "Detroit\nState: XX",
      zip: "48201",
    });
    expect(many.split("\n")).toHaveLength(3);
    // The client already controls the whole source text, so a value landing in
    // their own field is not an escalation; creating a line is what matters.
    expect(extractDeterministicClient(many).row.state).toBeUndefined();
  });

  it("ignores blank corrections instead of clearing a detected value", () => {
    const composed = composeIntakeSource(SOURCE, { email: "   ", city: "" });
    expect(composed).toBe(SOURCE);
    expect(extractDeterministicClient(composed).row.email).toBe("sara.detected@example.com");
  });

  it("covers exactly the ten client-safe fields", () => {
    expect([...CLIENT_EDITABLE_FIELDS]).toEqual([
      "full_name", "phone", "email", "date_of_birth", "street",
      "city", "state", "zip", "preferred_language", "english_proficiency",
    ]);
  });
});
