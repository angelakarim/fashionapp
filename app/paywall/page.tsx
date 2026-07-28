import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/entitlement";
import Paywall from "@/components/Paywall";

/**
 * Dynamic for the same reason as app/page.tsx: the CSP nonce minted per
 * request in middleware.ts can only be stamped onto Next.js's inline scripts
 * while rendering dynamically. Prerendered, this page would ship inert.
 */
export const dynamic = "force-dynamic";

const PAYMENT_LINK = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK;

/**
 * Builds the Stripe Payment Link URL for this specific user.
 *
 * `client_reference_id` is the whole mechanism tying a Stripe payment back to
 * a Supabase account — it comes back on checkout.session.completed and on the
 * return redirect, and both handlers refuse to grant access without it.
 */
function checkoutUrl(userId: string, email: string | undefined): string {
  const url = new URL(PAYMENT_LINK!);
  url.searchParams.set("client_reference_id", userId);
  if (email) url.searchParams.set("prefilled_email", email);
  return url.toString();
}

export default async function PaywallPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Repeats the middleware check on purpose — the gate must not rest on the
  // matcher config being correct.
  if (!user) redirect("/login?next=/paywall");

  // A subscriber who lands here (a stale link, a back button) belongs in the
  // app, not staring at a second checkout button.
  if (await hasAccess(supabase, user.id)) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();

  if (!PAYMENT_LINK) {
    // Deliberately vague to the visitor; the detail goes to the server log.
    console.error("[paywall] NEXT_PUBLIC_STRIPE_PAYMENT_LINK is not set");
    throw new Error("Checkout is not available right now.");
  }

  const { pending } = await searchParams;

  return (
    <Paywall
      displayName={profile?.name || user.email || "Account"}
      checkoutUrl={checkoutUrl(user.id, user.email)}
      pending={pending === "1"}
    />
  );
}
