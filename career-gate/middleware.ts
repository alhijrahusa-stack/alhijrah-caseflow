import { NextResponse, type NextRequest } from "next/server";
import { STAFF_COOKIE, verifyCookie } from "@/lib/staff-access";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const allowed = await verifyCookie(request.cookies.get(STAFF_COOKIE)?.value);
  if (allowed) return NextResponse.next();

  if (path.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: { code: "unauthorized", message: "Office access required" } }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/staff-access";
  url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/staff", "/staff/:path*", "/api/staff/:path*", "/api/documents/:path*"],
};
