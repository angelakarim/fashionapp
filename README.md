# ATELIER — Virtual Try-On

A single-page virtual try-on tool. Upload a photo of a person and a photo of a garment, and an
n8n workflow returns a generated image of the garment worn.

The whole app is behind email/password authentication — signed-out visitors are redirected to
`/login`. Access is a **$9.99/month subscription**, sold through a Stripe Payment Link: anyone can
create an account, but an account without an active subscription gets `/paywall` instead of the
studio, and `/api/tryon` answers `402`.

## Requirements

- Node.js 18.18+ (Next.js 15)
- A Supabase project (free tier is fine)
- A Stripe account (test mode is fine for local work)
- An n8n workflow exposing a webhook that accepts `multipart/form-data` and responds with a
  **binary image**

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the seven values below
npm run dev                  # http://localhost:3000
```

### Environment variables

All seven are required. The app throws at startup if any is missing.

| Variable | Public? | Where to find it |
|---|---|---|
| `TRYON_WEBHOOK_URL` | no | Your n8n workflow's Production webhook URL |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase → Project Settings → API |
| `SUPABASE_SECRET_KEY` | **no** | Supabase → Project Settings → API Keys (`service_role`) |
| `STRIPE_SECRET_KEY` | **no** | Stripe → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | **no** | Stripe → Developers → Webhooks → your endpoint |
| `NEXT_PUBLIC_STRIPE_PAYMENT_LINK` | yes | Stripe → Payment Links (see below) |

`TRYON_WEBHOOK_URL` is deliberately **not** `NEXT_PUBLIC_` — the browser calls `/api/tryon`,
which proxies to n8n server-side, so the webhook never ships to the client.

The two `NEXT_PUBLIC_SUPABASE_*` values *are* public by design: the browser talks to Supabase Auth
directly, and the publishable key only grants what row-level security allows.

`SUPABASE_SECRET_KEY` is the `service_role` key, which **bypasses RLS entirely**. It is the one
deliberate exception to the rule that this key never appears in the project, and it exists for a
single reason: Stripe's webhook arrives with no session, so there is no `auth.uid()` for RLS to
match, and `public.subscriptions` has no write policy on purpose. It is read only by
`lib/supabase/admin.ts`, which is imported only by `lib/subscriptionSync.ts`, which in turn is
imported only by `app/api/stripe/webhook/route.ts` and `app/billing/success/route.ts`. Keeping
that chain short is what limits the damage if it ever leaks — read-only checks live in
`lib/entitlement.ts` and never touch it. Never give it a `NEXT_PUBLIC_` prefix.

Use the n8n `/webhook/` path, which stays live while the workflow is Active. The editor's
`/webhook-test/` path also works but must be re-armed with "Execute workflow" before *every*
request — a 404 from it usually means it wasn't armed, not that the code is broken.

### Database

There is no migration checked in. Run this once against a fresh Supabase project.

`auth.users` is not client-writable, so the display name lives in `public.profiles`. The trigger
runs inside the signup transaction, so a user can never exist without a profile.

```sql
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

There is deliberately **no INSERT policy** — rows come only from the trigger, so a client cannot
forge a profile for an id it does not own.

Then the subscription table that gates access:

```sql
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  stripe_subscription_id text unique,
  status text not null,
  price_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;

create policy subscriptions_select_own on public.subscriptions
  for select using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.subscriptions from anon, authenticated;
```

Note that entitlement lives here rather than as a `has_paid` column on `profiles`. The
`profiles_update_own` policy lets a user update **any column of their own row**, so a flag there
would be self-grantable from the browser console with the publishable key. `subscriptions` has a
select-only policy and no write policy at all — rows come only from Stripe events, written with
the `service_role` key.

### Stripe

1. Create a **recurring** monthly price of $9.99 (`unit_amount: 999`, `interval: month`).
2. Create a **Payment Link** on that price. Set "after payment" to redirect to
   `<your-origin>/billing/success?session_id={CHECKOUT_SESSION_ID}` — the `{CHECKOUT_SESSION_ID}`
   placeholder is required, since that is what the return handler verifies against Stripe.
3. Create a **webhook endpoint** at `<your-origin>/api/stripe/webhook` subscribed to
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   and `customer.subscription.deleted`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Enable the **customer portal** (Settings → Billing → Customer portal) so `/billing/portal` can
   open it. Without a saved configuration Stripe rejects the request and the "Membership" button
   quietly sends the user home.

The app appends `?client_reference_id=<supabase user id>` to the payment link. That parameter is
the entire mechanism tying a Stripe payment back to an account — a checkout that arrives without
it is logged and ignored, because there is no one to credit.

Stripe cannot reach `localhost`, so **the webhook only fires against a deployed origin**. Locally,
the `/billing/success` redirect is what grants access; it verifies the session directly against
the Stripe API, so it works without a tunnel. To exercise the webhook itself locally, run
`stripe listen --forward-to localhost:3000/api/stripe/webhook` and use the secret it prints.

### A note on test accounts

Supabase rejects signups from non-deliverable domains, so `@example.com` and similar placeholders
fail with `email_address_invalid`. Use a real address. If "Confirm email" is enabled
(Authentication → Providers → Email), signup returns a user with no session and the form will
tell you to check your inbox.

## Commands

```bash
npm run dev      # dev server (falls back to :3001 if :3000 is taken)
npm run build    # production build — also the only type-check/lint gate here
npm start        # serve the production build
```

No test framework is configured; `npm run build` is what verifies a change compiles.

Some behaviour **only reproduces in a production build** — the Content-Security-Policy uses a
per-request nonce, and a page that gets prerendered ships without one, which silently leaves it
inert (it renders correctly but nothing is interactive). Verify UI changes with
`npm run build && npm start`, not just `npm run dev`, and confirm every route shows `ƒ` (Dynamic)
in the build output.

## Deployment (Vercel)

Next.js is auto-detected. There is no `vercel.json` and none is needed.

Currently deployed at **https://fashionapp-git-main-angela-95b5.vercel.app**, and the Stripe
Payment Link and webhook endpoint both point there. That is a Vercel *branch alias*, so it always
follows `main`; attaching a custom domain later means repointing both Stripe URLs again.

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Add all seven environment variables above, for **Production and Preview**, before the first
   build. A missing one fails the build rather than deploying something broken.
3. In Supabase → Authentication → URL Configuration, set the Site URL to the deployed origin and
   add it to Redirect URLs. Nothing in the code hardcodes an origin, so this is the only place
   the domain is configured — leave it on `localhost` and confirmation emails point at a dead
   link.
4. Point the Stripe **webhook endpoint** at `https://<your-domain>/api/stripe/webhook` and the
   **Payment Link** redirect at `https://<your-domain>/billing/success?session_id={CHECKOUT_SESSION_ID}`.
   Both are configured in Stripe, not in code.

Three limits to know before relying on it in production:

- **Renewals and cancellations reach the app only through the webhook.** If its URL is wrong or
  the signing secret does not match, subscriptions silently stop updating: nobody loses access
  immediately (`lib/entitlement.ts` allows a 3-day grace past `current_period_end`), but a
  cancelled subscriber keeps access until that window closes and a renewing one loses it after.
  Check Developers → Webhooks for 4xx/5xx deliveries after any domain change.
- Rate limiting (`lib/rateLimit.ts`) is in-memory, so limits are **per-instance and reset on cold
  start**. It raises the cost of casual abuse but is not a hard guarantee; a durable limit needs
  Vercel KV or Upstash.
- `/api/tryon` sets `maxDuration = 60`, the Hobby-plan ceiling. A slow generation can time out.

Uploads are downscaled in the browser to max 1600px before sending, because Vercel caps request
bodies at ~4.5MB and two phone photos can exceed that.

## How it works

```
browser → POST /api/tryon → n8n webhook → binary image → object URL → <img>
```

Access is gated in three places, and only the last one matters for security:

```
middleware.ts        session only — redirects signed-out visitors to /login
app/page.tsx         redirects unsubscribed accounts to /paywall  (advisory UX)
app/api/tryon        402 without an active subscription           (trust boundary)
```

Payment flows in from two directions, both landing in the same idempotent
`syncSubscription()` in `lib/subscriptionSync.ts`: `/billing/success` verifies the checkout session
against Stripe when the customer is redirected back (immediate, works on localhost), and
`/api/stripe/webhook` handles everything the customer isn't present for — renewals, failed cards,
cancellations.

The billing routes, all `runtime = "nodejs"`:

| Route | Method | Purpose |
|---|---|---|
| `/billing/success` | GET | Where the Payment Link returns. Grants access immediately after verifying the session against Stripe and confirming `client_reference_id` matches the signed-in user |
| `/api/stripe/webhook` | POST | Stripe's view of a subscription, mirrored into Supabase. Signature-verified; `middleware.ts` skips this path so the unauthenticated POST costs no session lookup |
| `/billing/portal` | POST | Opens Stripe's hosted portal so a subscriber can change their card or cancel. Nothing in this app can cancel a subscription itself |

- `app/page.tsx` holds all application state; `components/` is presentational.
- `app/api/tryon/route.ts` is the trust boundary. Every client-side check is repeated there —
  anything in the UI is advisory and trivially bypassed by POSTing directly. It enforces auth,
  the subscription check, two rate limits, raster-only image types, and size caps, and rebuilds
  the outbound payload from scratch so extra form fields can't be injected into the n8n workflow.
- n8n signals failure with a JSON body rather than an error status, so both the server and the
  client check the response is really an image before rendering it.

For architectural detail and the reasoning behind these constraints, see [CLAUDE.md](CLAUDE.md).
