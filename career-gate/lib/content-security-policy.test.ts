import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type Config = { headers(): Promise<HeaderRule[]> };

async function policies(storageUrl?: string) {
  // Evaluate each configuration independently: the build reads this public URL
  // once, so changing require's process-wide cache would hide regressions.
  const configModule = { exports: {} as Config };
  runInNewContext(readFileSync(new URL("../next.config.js", import.meta.url), "utf8"), {
    module: configModule, URL, process: { env: { NEXT_PUBLIC_SUPABASE_URL: storageUrl } },
  });
  return (await configModule.exports.headers()).slice(0, 2).map(rule => {
    const value = rule.headers.find(header => header.key === "Content-Security-Policy")!.value;
    return new Map(value.split(";").map(directive => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }));
  });
}

describe("private document media CSP", () => {
  for (const origin of ["https://configured-project.supabase.co", "http://127.0.0.1:54999"]) {
    it(`allows signed previews only on the configured storage origin (${origin})`, async () => {
      for (const policy of await policies(`${origin}/`)) {
        expect(policy.get("img-src")).toEqual(["'self'", "blob:", origin, "data:"]);
        expect(policy.get("frame-src")).toEqual(["'self'", "blob:", origin]);
        expect(policy.get("object-src")).toEqual(["'none'"]);
        expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
        expect(policy.get("form-action")).toEqual(["'self'"]);
      }
    });
  }

  it("does not allow arbitrary remote image or frame hosts when storage is unconfigured", async () => {
    for (const policy of await policies()) {
      expect(policy.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
      expect(policy.get("frame-src")).toEqual(["'self'", "blob:"]);
    }
  });
});
