/**
 * Supabase connection details.
 *
 * Unlike TRYON_WEBHOOK_URL, these are deliberately NEXT_PUBLIC_. The browser
 * talks to Supabase Auth directly, so both values ship to the client by design
 * — the publishable key is safe to expose because every table is guarded by
 * row-level security. The service-role key is the one that must never appear
 * here; nothing in this app needs it.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error(
    "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example)."
  );
}
