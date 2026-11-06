#!/usr/bin/env node
// Production integration test with real audio and real Groq inference.
// Requires an actual MURAILEX user authorized to upload; no mocks or fake results.
// Example:
// MURAILEX_TEST_EMAIL=... MURAILEX_TEST_PASSWORD=... node murailex/scripts/test-stt.js

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const base = process.env.MURAILEX_TEST_URL ?? "https://murailex-frontend-production.up.railway.app";
const email = process.env.MURAILEX_TEST_EMAIL;
const password = process.env.MURAILEX_TEST_PASSWORD;
const samplePath = resolve(import.meta.dirname, "../backend/tests/fixtures/sample.wav");

if (!email || !password) {
  process.stderr.write("[BLOCKER: MURAILEX_TEST_EMAIL/MURAILEX_TEST_PASSWORD not configured]\n");
  process.exit(2);
}

const login = await fetch(new URL("/api/auth/login", base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
  redirect: "manual",
});
if (login.status !== 200) {
  process.stderr.write("LOGIN_FAILED HTTP " + login.status + "\n");
  process.exit(1);
}
const loginPayload = await login.json();
const csrf = loginPayload.csrf_token;
const cookieLines = login.headers.getSetCookie();
const cookie = cookieLines.map((line) => line.split(";")[0]).join("; ");
if (!cookie || !csrf) {
  process.stderr.write("LOGIN_FAILED: missing cookie or CSRF token\n");
  process.exit(1);
}

const raw = await readFile(samplePath);
const form = new FormData();
form.set("file", new Blob([raw], { type: "audio/wav" }), "sample.wav");
form.set("language", "auto");
form.set("consent", "true");
const started = performance.now();
const response = await fetch(new URL("/api/voice-ai/stt", base), {
  method: "POST",
  headers: { cookie, "x-csrf-token": csrf },
  body: form,
  redirect: "manual",
});
if (response.status !== 200) {
  const body = await response.text();
  process.stderr.write("STT_FAILED HTTP " + response.status + ": " + body.slice(0, 300) + "\n");
  process.exit(1);
}

const output = await response.json();
if (typeof output.text !== "string" || !output.text.trim()) {
  process.stderr.write("STT_FAILED: empty transcript\n");
  process.exit(1);
}
if (!Array.isArray(output.segments) || !Array.isArray(output.words)) {
  process.stderr.write("STT_FAILED: missing timestamps array\n");
  process.exit(1);
}
const sha256 = createHash("sha256").update(raw).digest("hex");
if (output.source_sha256 !== sha256) {
  process.stderr.write("STT_FAILED: input SHA mismatch\n");
  process.exit(1);
}
process.stdout.write("STT_LIVE_TEST=SUCCESS\n");
process.stdout.write("MODEL=" + output.model + "\n");
process.stdout.write("AUDIO_SHA256=" + sha256 + "\n");
process.stdout.write("SEGMENTS=" + output.segments.length + "\n");
process.stdout.write("WORDS=" + output.words.length + "\n");
process.stdout.write("CLIENT_ELAPSED_MS=" + Math.round(performance.now() - started) + "\n");
process.stdout.write("TRANSCRIPT=" + output.text + "\n");
