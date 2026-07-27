import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

export type PendingCookie = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

/**
 * Refresh the auth session for an incoming request.
 *
 * Access tokens are short-lived, so without a refresh on each request a user
 * gets silently logged out mid-session. This cannot simply return a Response
 * the way the Supabase docs' `updateSession` does, because middleware.ts also
 * has to attach a CSP nonce to the same response — so the refreshed cookies are
 * handed back for the caller to apply to whichever response it ends up
 * building (a pass-through or a redirect).
 *
 * `request.cookies.set` is still called so that the rest of this request sees
 * the new tokens; `pending` carries them out to the browser.
 */
export async function refreshSession(
  request: NextRequest
): Promise<{ user: User | null; cookies: PendingCookie[] }> {
  const pending: PendingCookie[] = [];

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          pending.push({ name, value, options: options ?? {} });
        }
      },
    },
  });

  // getUser(), not getSession(): it revalidates the token with the auth server
  // instead of trusting a cookie the client could have forged.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user, cookies: pending };
}
