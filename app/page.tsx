import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/entitlement";
import TryOnApp from "@/components/TryOnApp";

/**
 * Rendered per request rather than prerendered at build time.
 *
 * The CSP in middleware.ts mints a fresh nonce for every request, and Next.js
 * can only stamp that nonce onto its inline hydration scripts while rendering
 * dynamically. A statically prerendered page would ship without nonces, and
 * 'strict-dynamic' would then block every script — leaving the page inert.
 *
 * Reading the session below makes this dynamic regardless, but the export stays
 * as the explicit, load-bearing reason.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware already redirects signed-out visitors. This repeats the
  // check because a page that renders the studio must never depend on the
  // matcher config being correct.
  if (!user) redirect("/login");

  // Signing up is free; generating is not. An account without an active
  // subscription gets the paywall instead of the studio. This is advisory UX —
  // /api/tryon repeats the check, and that is what actually protects the
  // upstream credits.
  if (!(await hasAccess(supabase, user.id))) redirect("/paywall");

  // RLS restricts this to the caller's own row, so no filter is load-bearing
  // for security — the .eq() is just to select a single row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();

  return <TryOnApp displayName={profile?.name || user.email || "Account"} />;
}
