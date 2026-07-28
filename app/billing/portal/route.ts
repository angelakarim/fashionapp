import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Hands a subscriber off to Stripe's hosted billing portal, where they can
 * update their card, read invoices, or cancel. The paywall promises "cancel
 * anytime", and this is the only thing that makes that true — nothing in this
 * app can cancel a subscription itself.
 *
 * POST-only, like /auth/signout: a GET would be triggerable by a stray <img>
 * tag, and this one bills a redirect through a customer's account.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/", req.url), {
      status: 303,
    });
  }

  // RLS restricts this to the caller's own row, so the customer id can only
  // ever be their own — there is no way to open someone else's portal.
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!subscription?.stripe_customer_id) {
    // Never subscribed, so there is nothing to manage.
    return NextResponse.redirect(new URL("/paywall", req.url), { status: 303 });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: new URL("/", req.url).toString(),
    });
    return NextResponse.redirect(session.url, { status: 303 });
  } catch (e) {
    // Most likely the portal has no default configuration in this Stripe
    // account (Settings → Billing → Customer portal). Log it and send the user
    // somewhere coherent rather than showing a stack trace.
    console.error("[billing] could not open the customer portal:", e);
    return NextResponse.redirect(new URL("/?billing=unavailable", req.url), {
      status: 303,
    });
  }
}
