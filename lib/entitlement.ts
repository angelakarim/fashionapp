import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Read-only entitlement checks, safe to import from anywhere that renders.
 *
 * Everything here runs on the *caller's* Supabase client, so the select-own RLS
 * policy is what restricts the data. The service-role writes deliberately live
 * in lib/subscriptionSync.ts instead: importing them from here would drag
 * lib/supabase/admin.ts — and the key that bypasses RLS — into every Server
 * Component that only wanted to ask "is this user subscribed?".
 */

/**
 * Subscription states that grant access. `past_due` is deliberately excluded:
 * Stripe keeps a subscription there while it retries a failed payment, and we
 * would rather a lapsed card lose access than keep spending Gemini credits.
 * The grace window below already covers the ordinary case of a renewal whose
 * webhook is briefly late.
 */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * How long past `current_period_end` a subscription still counts as active.
 *
 * Renewal only reaches this database through a webhook. If a delivery is
 * delayed or retried, a paying customer would otherwise be locked out at the
 * exact moment they were charged. Three days is long enough to absorb Stripe's
 * retry schedule and short enough that a genuinely dead subscription doesn't
 * linger.
 */
const RENEWAL_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export type SubscriptionRow = {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

/** True when this row should unlock the app right now. */
export function isActive(row: SubscriptionRow | null | undefined): boolean {
  if (!row || !ACTIVE_STATUSES.has(row.status)) return false;
  if (!row.current_period_end) return true;

  const end = Date.parse(row.current_period_end);
  if (Number.isNaN(end)) return true; // Don't lock out a paying user over a bad timestamp.

  return end + RENEWAL_GRACE_MS > Date.now();
}

/**
 * Reads the caller's own subscription. Safe to call with a user-scoped client:
 * the select-own RLS policy is what restricts the row, so the .eq() is only
 * selecting a single row rather than carrying the security.
 */
export async function getSubscription(
  supabase: SupabaseClient,
  userId: string
): Promise<SubscriptionRow | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // Fail closed. A database hiccup must not hand out free generations.
    console.error("[entitlement] subscription lookup failed:", error.message);
    return null;
  }

  return data;
}

/** Convenience wrapper for the two gates that only need a yes/no. */
export async function hasAccess(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return isActive(await getSubscription(supabase, userId));
}