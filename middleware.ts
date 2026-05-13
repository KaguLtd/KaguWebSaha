import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

const protectedPrefixes = ["/admin", "/personnel"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedPath = protectedPrefixes.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (!isProtectedPath) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/personnel/:path*"],
};
