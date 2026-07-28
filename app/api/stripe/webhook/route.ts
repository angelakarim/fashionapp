import type Stripe from "stripe";
import { stripe, STRIPE_WEBHOOK_SECRET } from "@/lib/stripe";
import { resolveUserId, syncSubscription } from "@/lib/subscriptionSync";

export const runtime = "nodejs";

/**
 * Stripe's view of a subscription, mirrored into Supabase.
 *
 * This endpoint is the only thing that ever learns about a renewal, a failed
 * card, or a cancellation — the user is not in the browser when those happen.
 * Access therefore depends on it being reachable in production; see the
 * deployment notes in README.md.
 *
 * It is unauthenticated by necessity (Stripe has no session), so the signature
 * check below is the entire trust boundary. middleware.ts skips this path so
 * the unauthenticated POST doesn't trigger a session lookup.
 */
export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature.", { status: 400 });
  }

  // The raw body is required: the signature is computed over the exact bytes
  // Stripe sent, so parsing to JSON first would invalidate it.
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    // Either a forgery or a signing-secret mismatch. Neither is worth retrying.
    console.error("[stripe] signature verification failed:", e);
    return new Response("Invalid signature.", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await handleCheckoutCompleted(event.data.object);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // `deleted` is not a special case: the subscription arrives with
        // status "canceled", and isActive() already refuses that.
        const subscription = event.data.object;
        const userId = await resolveUserId(subscription);

        if (!userId) {
          // Almost certainly a subscription event that overtook its
          // checkout.session.completed. That event will create the row.
          console.warn(
            `[stripe] no user for subscription ${subscription.id}; skipping`
          );
          break;
        }

        await syncSubscription(userId, subscription);
        break;
      }

      default:
        // Subscribed elsewhere or added later in the dashboard — acknowledge
        // rather than 400, so Stripe doesn't retry something we ignore.
        break;
    }
  } catch (e) {
    // Answer non-2xx so Stripe retries. A dropped event means a paying
    // customer silently loses access, so this must not be swallowed.
    console.error(`[stripe] handling ${event.type} failed:`, e);
    return new Response("Handler failed.", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

/**
 * The one event that carries the Supabase user id: `client_reference_id` is
 * set on the Payment Link URL by the paywall.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.client_reference_id;

  if (!userId) {
    // A checkout started somewhere other than our paywall (a link shared
    // directly, say). There is no user to attach it to.
    console.warn(
      `[stripe] checkout ${session.id} has no client_reference_id; skipping`
    );
    return;
  }

  if (session.payment_status !== "paid" && session.status !== "complete") {
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;

  if (!subscriptionId) {
    console.warn(`[stripe] checkout ${session.id} has no subscription`);
    return;
  }

  // Stamp the user id onto the subscription so later lifecycle events — which
  // carry no client_reference_id — can identify the user without a lookup.
  const subscription = await stripe.subscriptions.update(subscriptionId, {
    metadata: { supabase_user_id: userId },
  });

  await syncSubscription(userId, subscription);
}
