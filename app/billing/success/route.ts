import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { syncSubscription } from "@/lib/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Stripe returns the customer after a successful Payment Link checkout.
 *
 * The webhook is the durable source of truth, but it can be seconds behind and
 * it cannot reach a localhost dev server at all. Without this, a user who just
 * paid would land back on the paywall. So the session is verified directly
 * against Stripe here and access is granted immediately; both paths funnel
 * through the same idempotent syncSubscription().
 *
 * `session_id` comes from the URL, so it is attacker-controlled — every fact
 * used below is read back from Stripe rather than trusted from the query
 * string, and the session must belong to the signed-in user.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/", req.url), {
      status: 303,
    });
  }

  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.redirect(new URL("/paywall", req.url), { status: 303 });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    // The decisive check: someone else's paid session must not unlock this
    // account, even though they'd need to guess the session id to try.
    if (session.client_reference_id !== user.id) {
      console.warn(
        `[billing] session ${sessionId} belongs to ${session.client_reference_id}, not ${user.id}`
      );
      return NextResponse.redirect(new URL("/paywall", req.url), {
        status: 303,
      });
    }

    if (session.payment_status !== "paid" && session.status !== "complete") {
      // Card still processing, or the checkout was abandoned. The webhook will
      // grant access if and when it does settle.
      return NextResponse.redirect(new URL("/paywall?pending=1", req.url), {
        status: 303,
      });
    }

    const subscription = session.subscription;
    if (!subscription || typeof subscription === "string") {
      console.error(`[billing] session ${sessionId} has no expanded subscription`);
      return NextResponse.redirect(new URL("/paywall?pending=1", req.url), {
        status: 303,
      });
    }

    await syncSubscription(user.id, subscription);
  } catch (e) {
    // A bad session id or a Stripe outage. The webhook remains the backstop,
    // so send the user to the paywall rather than showing an error page.
    console.error("[billing] could not confirm checkout session:", e);
    return NextResponse.redirect(new URL("/paywall?pending=1", req.url), {
      status: 303,
    });
  }

  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
