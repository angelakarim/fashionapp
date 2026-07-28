import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Service-role client. This is the one deliberate exception to the rule in
 * lib/supabase/env.ts that the service-role key must never appear in this
 * project.
 *
 * Why it has to exist: Stripe's webhook arrives with no user session and no
 * cookies, so there is no `auth.uid()` for RLS to match against. Something has
 * to write `public.subscriptions`, and that table has no insert/update policy
 * on purpose — if a client could write it, a user could grant themselves a
 * subscription from the browser console with the publishable key.
 *
 * The key bypasses RLS entirely, so the blast radius is contained by import
 * discipline: this module is imported ONLY by app/api/stripe/webhook/route.ts
 * and app/billing/success/route.ts. Never import it from a Server Component,
 * a "use client" file, or anything under components/.
 */
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY!;

if (!SUPABASE_SECRET_KEY) {
  throw new Error(
    "SUPABASE_SECRET_KEY is not set. The Stripe webhook cannot record " +
      "subscriptions without it (see .env.example)."
  );
}

/**
 * No cookie handling and no token refresh: this client is never acting on
 * behalf of a signed-in user, and persisting a session would be meaningless
 * in a stateless route handler.
 */
export function createAdminClient() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
