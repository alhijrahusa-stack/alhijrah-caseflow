import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from "@/lib/jwt";

const PUBLIC_API = [/^\/api\/intake(\/|$)/, /^\/api\/status(\/|$)/, /^\/api\/staff\/auth\//, /^\/api\/webhooks\//, /^\/api\/cron\//];
const STAFF_API = [/^\/api\/staff\//, /^\/api\/documents\//, /^\/api\/audit\//];

function cookieOpts(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

async function refresh(refreshToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const s = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return (await verifyAccessToken(s.access_token)) ? s : null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  // CSRF: state-changing API calls must come from this origin (webhooks/cron excluded).
  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !/^\/api\/(webhooks|cron)\//.test(path)) {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== req.headers.get("host")) {
      return NextResponse.json({ ok: false, error: { code: "forbidden", message: "Cross-origin request rejected" } }, { status: 403 });
    }
  }

  const needsStaff = (path.startsWith("/staff") && path !== "/staff/login") || (isApi && STAFF_API.some((r) => r.test(path)) && !PUBLIC_API.some((r) => r.test(path)));
  if (!needsStaff) return NextResponse.next();

  if (await verifyAccessToken(req.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();

  const rt = req.cookies.get(REFRESH_COOKIE)?.value;
  const s = rt ? await refresh(rt) : null;
  if (s) {
    const headers = new Headers(req.headers);
    const others = req.cookies.getAll().filter((c) => c.name !== ACCESS_COOKIE && c.name !== REFRESH_COOKIE);
    headers.set("cookie", [...others.map((c) => `${c.name}=${c.value}`), `${ACCESS_COOKIE}=${s.access_token}`, `${REFRESH_COOKIE}=${s.refresh_token}`].join("; "));
    const res = NextResponse.next({ request: { headers } });
    res.cookies.set(ACCESS_COOKIE, s.access_token, cookieOpts(s.expires_in));
    res.cookies.set(REFRESH_COOKIE, s.refresh_token, cookieOpts(60 * 60 * 24 * 7));
    return res;
  }

  if (isApi) return NextResponse.json({ ok: false, error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/staff/login";
  url.search = `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
  const res = NextResponse.redirect(url);
  res.cookies.delete(ACCESS_COOKIE);
  return res;
}

export const config = { matcher: ["/staff/:path*", "/api/:path*"] };
