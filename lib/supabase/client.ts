import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/**
 * Browser-side client, used by the sign-in / sign-up form.
 *
 * Writes the session to cookies (not localStorage) so the server components and
 * middleware in this app can read it on the next request.
 */
export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
}
