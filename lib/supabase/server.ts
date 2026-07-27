import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_KEY, SUPABASE_URL } from "./env";

/**
 * Server-side client for Server Components and Route Handlers.
 *
 * Cookie writes are wrapped in try/catch because Server Components are not
 * allowed to set cookies. That is harmless here: the middleware refreshes the
 * session on every request, so the refreshed tokens are already persisted by
 * the time a component reads them.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component — middleware handles the refresh.
        }
      },
    },
  });
}
