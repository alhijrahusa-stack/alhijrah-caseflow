import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedMutationOrigin } from "./request-origin";

function mutation(origin: string | null, url = "http://localhost:3456/api/status/appointment-action", host = "localhost:3456", forwarded?: string) {
  const headers = new Headers({ host });
  if (origin !== null) headers.set("origin", origin);
  if (forwarded) headers.set("x-forwarded-host", forwarded);
  return new Request(url, { method: "POST", headers });
}

describe("client appointment POST Origin protection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts exact same-origin requests", () => {
    expect(isTrustedMutationOrigin(mutation("https://portal.example.com", "https://portal.example.com/api/status/appointment-action", "portal.example.com"))).toBe(true);
  });

  it("accepts the two loopback hostnames only at the same port in local production-build E2E", () => {
    expect(isTrustedMutationOrigin(mutation("http://127.0.0.1:3456"))).toBe(true);
    expect(isTrustedMutationOrigin(mutation("http://localhost:3456", "http://127.0.0.1:3456/api/status/appointment-action", "127.0.0.1:3456"))).toBe(true);
    expect(isTrustedMutationOrigin(mutation("http://127.0.0.1:3457"))).toBe(false);
  });

  it("rejects arbitrary external, opaque and malformed origins", () => {
    expect(isTrustedMutationOrigin(mutation("https://evil.example"))).toBe(false);
    expect(isTrustedMutationOrigin(mutation("null"))).toBe(false);
    expect(isTrustedMutationOrigin(mutation("https://portal.example.com.evil.example"))).toBe(false);
    expect(isTrustedMutationOrigin(mutation("https://portal.example.com/path"))).toBe(false);
  });

  it("does not accept untrusted X-Forwarded-Host outside Vercel", () => {
    vi.stubEnv("VERCEL", "");
    expect(isTrustedMutationOrigin(mutation("https://evil.example", "https://portal.example.com/api/status/appointment-action", "portal.example.com", "evil.example"))).toBe(false);
  });

  it("accepts Vercel's forwarded public hostname for proxied production requests", () => {
    vi.stubEnv("VERCEL", "1");
    expect(isTrustedMutationOrigin(mutation("https://portal.example.com", "http://internal:3000/api/status/appointment-action", "internal:3000", "portal.example.com"))).toBe(true);
  });

  it("keeps existing origin-less server-to-server behavior", () => {
    expect(isTrustedMutationOrigin(mutation(null))).toBe(true);
  });
});
