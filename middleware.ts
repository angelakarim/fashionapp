import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Per-request CSP nonce.
 *
 * Next.js emits inline <script> tags carrying hydration data, so a policy of
 * `script-src 'self'` alone blocks hydration and leaves the page inert. Rather
 * than weakening the policy with 'unsafe-inline', a fresh nonce is minted here;
 * Next.js reads it from the Content-Security-Policy request header below and
 * stamps it onto its own script tags.
 *
 * 'strict-dynamic' lets those nonced bootstrap scripts load the chunk files
 * they need without enumerating each one.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    `connect-src 'self'${isDev ? " ws:" : ""}`,
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

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Static assets and the image optimizer don't need a per-request nonce.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
