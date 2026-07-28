import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The service-role write path: Stripe's view of a subscription, mirrored into
 * `public.subscriptions`.
 *
 * Kept in its own module rather than alongside the read helpers in
 * lib/entitlement.ts, because importing anything from here drags
 * lib/supabase/admin.ts — and with it the key that bypasses RLS — into the
 * importing module's graph. Only route handlers that genuinely act on Stripe's
 * behalf should do that:
 *
 *   app/api/stripe/webhook/route.ts
 *   app/billing/success/route.ts
 *
 * Never import this from a Server Component, a "use client" file, or anything
 * under components/. To ask whether a user is subscribed, use hasAccess() from
 * lib/entitlement.ts, which runs on the caller's own RLS-scoped client.
 */

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
