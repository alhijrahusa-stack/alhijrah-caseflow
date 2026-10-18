/**
 * Same-origin verification for client appointment mutations.
 *
 * Next.js may construct req.url using an internal loopback host in the
 * production-build E2E server. Compare browser Origin against the explicit Host
 * and request URL; only normalize the two loopback hostnames at the same port.
 * Never accept arbitrary X-Forwarded-Host values from outside Vercel.
 */
export function isTrustedMutationOrigin(req: Request): boolean {
  const raw = req.headers.get("origin");
  if (!raw) return true;

  try {
    const origin = new URL(raw);
    if (!["http:", "https:"].includes(origin.protocol) ||
        origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
      return false;
    }

    const requestUrl = new URL(req.url);
    const candidates = [req.headers.get("host"), requestUrl.host];
    if (process.env.VERCEL === "1") candidates.push(req.headers.get("x-forwarded-host"));
    const originHost = origin.host.toLowerCase();

    if (candidates.some(value => value?.toLowerCase() === originHost)) return true;

    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    return candidates.some(value => {
      if (!value) return false;
      const candidate = new URL(`http://${value}`);
      return loopback.has(origin.hostname.toLowerCase()) &&
        loopback.has(candidate.hostname.toLowerCase()) &&
        origin.port === candidate.port;
    });
  } catch {
    return false;
  }
}
