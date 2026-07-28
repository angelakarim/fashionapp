import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { refreshSession, type PendingCookie } from "@/lib/supabase/middleware";
import { SUPABASE_URL } from "@/lib/supabase/env";

/** Paths reachable without a session. Everything else redirects to /login. */
const PUBLIC_PATHS = ["/login"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

function applyCookies(response: NextResponse, cookies: PendingCookie[]) {
  for (const { name, value, options } of cookies) {
    response.cookies.set(name, value, options);
  }
}

/**
 * Two jobs on every request: refresh the Supabase session, and mint the CSP
 * nonce.
 *
 * They share one response object, which is why the session refresh returns
 * cookies rather than a Response of its own — a redirect for a signed-out
 * visitor still needs the CSP, and a pass-through still needs the cookies.
 *
 * Per-request CSP nonce
 * ---------------------
 * Next.js emits inline <script> tags carrying hydration data, so a policy of
 * `script-src 'self'` alone blocks hydration and leaves the page inert. Rather
 * than weakening the policy with 'unsafe-inline', a fresh nonce is minted here;
 * Next.js reads it from the Content-Security-Policy request header below and
 * stamps it onto its own script tags.
 *
 * 'strict-dynamic' lets those nonced bootstrap scripts load the chunk files
 * they need without enumerating each one.
 */
export async function middleware(request: NextRequest) {
  // Runs first: it may rewrite request.cookies, and the forwarded request
  // headers are snapshotted below.
  const { user, cookies } = await refreshSession(request);

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    // The browser client calls Supabase Auth directly, so its origin has to be
    // reachable — 'self' alone would block every sign-in attempt.
    `connect-src 'self' ${SUPABASE_URL}${isDev ? " ws:" : ""}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js parses the nonce out of this request header.
  requestHeaders.set("Content-Security-Policy", csp);

  const { pathname } = request.nextUrl;

  // API routes authenticate themselves and answer with a status code; bouncing
  // an XHR to an HTML login page would surface as an unparseable response.
  const isApi = pathname.startsWith("/api/");

  let response: NextResponse;

  if (!user && !isPublic(pathname) && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the destination so sign-in can return the user to it.
    url.searchParams.set("next", pathname);
    response = NextResponse.redirect(url);
  } else if (user && isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    response = NextResponse.redirect(url);
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  applyCookies(response, cookies);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Static assets and the image optimizer don't need a per-request nonce.
    // No `missing:` clause excluding prefetch requests here. The CSP examples
    // in the Next.js docs skip middleware when `next-router-prefetch` or
    // `purpose: prefetch` is present, to avoid burning a nonce on a response
    // that may be cached. Those headers are just request headers, though —
    // anyone can send them with curl, and doing so would skip the session
    // check and the CSP entirely. The auth gate has to run on every request,
    // so the exclusion is deliberately omitted.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
