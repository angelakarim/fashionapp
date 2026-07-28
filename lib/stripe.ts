import Stripe from "stripe";

/**
 * Server-side Stripe client.
 *
 * Unlike the Supabase values in lib/supabase/env.ts, none of these are
 * NEXT_PUBLIC_ except the payment link — which is just a public URL a visitor
 * is about to be sent to anyway. The secret key and the webhook signing secret
 * must never reach the browser, so this module is only ever imported from
 * route handlers.
 */
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;

export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
  throw new Error(
    "Stripe is not configured. Set STRIPE_SECRET_KEY and " +
      "STRIPE_WEBHOOK_SECRET in .env.local (see .env.example)."
  );
}

/**
 * The API version is left at the SDK's pinned default rather than overridden.
 * That matters for one field in particular: as of 2026-06-24.dahlia,
 * `current_period_end` is no longer on the Subscription object — it lives on
 * each subscription *item*. See periodEnd() in lib/entitlement.ts.
 */
export const stripe = new Stripe(STRIPE_SECRET_KEY);
