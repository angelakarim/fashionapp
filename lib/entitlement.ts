import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

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

/**
 * As of API version 2026-06-24.dahlia, `current_period_end` was removed from
 * the Subscription object and lives on each subscription item instead. A
 * subscription can hold several items; the latest end is the one that governs
 * access.
 */
function periodEnd(subscription: Stripe.Subscription): string | null {
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number");

  if (ends.length === 0) return null;
  return new Date(Math.max(...ends) * 1000).toISOString();
}

function idOf(value: string | { id: string } | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Mirrors a Stripe subscription into `public.subscriptions`.
 *
 * Called from both the webhook and the post-checkout return handler, which is
 * why it upserts rather than inserts: a duplicate webhook delivery, a page
 * refresh on the return URL, and a renewal months later all land here and must
 * converge on the same row. `user_id` is the conflict target because the app
 * grants access per user, not per subscription.
 *
 * Uses the service-role client — `public.subscriptions` has no write policy.
 */
export async function syncSubscription(
  userId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_customer_id: idOf(subscription.customer),
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      price_id: subscription.items.data[0]?.price.id ?? null,
      current_period_end: periodEnd(subscription),
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    // Thrown so the webhook answers non-2xx and Stripe retries the delivery.
    throw new Error(`Failed to sync subscription: ${error.message}`);
  }
}

/**
 * Resolves the app user behind a Stripe subscription.
 *
 * Subscription lifecycle events (renewal, cancellation) carry no
 * `client_reference_id` — that only exists on the Checkout Session. So the
 * link is recovered two ways: from metadata stamped onto the subscription at
 * checkout, and failing that from the customer id recorded on the first sync.
 *
 * Returns null when neither is available, which happens if a subscription
 * event arrives before its checkout.session.completed. That is safe to ignore:
 * the checkout event creates the row moments later.
 */
export async function resolveUserId(
  subscription: Stripe.Subscription
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.supabase_user_id;
  if (fromMetadata) return fromMetadata;

  const customerId = idOf(subscription.customer);
  if (!customerId) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  return data?.user_id ?? null;
}
