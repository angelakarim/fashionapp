# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
cp .env.example .env.local   # first-time setup; seven vars — n8n, three Supabase, three Stripe
npm run dev      # dev server; falls back to :3001 if :3000 is taken by another local app
npm run build    # production build — also the only type-check/lint gate in this repo
npm start        # serve the production build
```

No test framework is configured. `npm run build` is what verifies a change compiles and
type-checks; run it before considering work done.

## What this app does

A single-page virtual try-on tool. The user uploads two images (a person and a garment), the app
POSTs them as `multipart/form-data` to an n8n webhook, and the webhook returns a **binary image**
— not JSON — which is rendered from an object URL.

Access is a **$9.99/month Stripe subscription**. Signup is free; generating is not.

## Architecture

All application state lives in `app/page.tsx` (a client component). `components/` holds
presentational pieces that own no request state; `app/api/tryon/route.ts` is the only server code.

### The request path, and why it goes through a proxy

Browser (`app/page.tsx`) → `POST /api/tryon` → `app/api/tryon/route.ts` → n8n webhook → binary
image streamed back → `response.blob()` → `URL.createObjectURL()` → `<img>`.

The browser never calls n8n directly. The proxy exists so the app doesn't depend on n8n returning
CORS headers, and so `TRYON_WEBHOOK_URL` stays server-side. Keep it that way — do not add a
`NEXT_PUBLIC_` webhook variable.

The proxy re-sends the *parsed* `FormData` to n8n so `fetch` generates a fresh multipart boundary
rather than reusing the incoming request's.

### The webhook URL is environment-dependent, and the default is fragile

`TRYON_WEBHOOK_URL` in `.env.local` points at an n8n **`/webhook-test/`** path. That path is only
live while the n8n editor has "Execute workflow" armed, and it accepts a single request before
going dead — a 404 from this endpoint usually means the workflow isn't armed, not that the code
broke. Once the workflow is activated in n8n, swap `webhook-test` → `webhook` in the env var; no
code change is needed.

### n8n signals failure with JSON, so responses are checked twice

A failed n8n node returns a JSON body with a 200-ish shape. Handing that blob to an `<img>` renders
a broken image with no explanation, so both layers guard against it:

- **Server** (`route.ts`): rejects any upstream response whose `Content-Type` isn't `image/*`, and
  runs the body through `describe()` to extract n8n's `message`/`hint` fields instead of dumping raw
  JSON into the UI.
- **Client** (`page.tsx`): re-checks `blob.type` and `blob.size` before creating an object URL.

Preserve both checks when touching the response path.

### Authentication

Supabase Auth, email + password. The whole app is behind it: `middleware.ts` redirects any
signed-out request to `/login?next=…`, and `/api/tryon` answers `401` rather than redirecting
(an XHR bounced to an HTML page surfaces as an unparseable response).

The middleware matcher must not carry the `missing: [next-router-prefetch, purpose=prefetch]`
clause from the Next.js CSP docs. Those are ordinary request headers, so sending either one
skips middleware — and with it the session check and the CSP. `app/page.tsx` repeats the
`getUser()` check for the same reason: the gate can't rest on the matcher alone.

There is no migration checked in; `README.md` carries the schema SQL (table, RLS policies,
trigger) for setting up a fresh Supabase project. Keep it in sync if the schema changes.

`auth.users` holds the credentials and is not client-writable, so the display name lives in
`public.profiles` (`id` → `auth.users.id`, `name`, `email`). The name is passed to `signUp()` as
`options.data.name`, which Supabase stores on `raw_user_meta_data`; the `on_auth_user_created`
trigger copies it into `profiles` **inside the signup transaction**, so a user can never exist
without a profile. RLS on `profiles` allows select/update of your own row only, and there is
deliberately **no INSERT policy** — rows come from the trigger, so a client can't forge a profile
for an id it doesn't own.

Three clients, because cookie handling differs by context — don't collapse them:

| File | Used by |
|---|---|
| `lib/supabase/client.ts` | browser (`AuthForm`) |
| `lib/supabase/server.ts` | Server Components, Route Handlers |
| `lib/supabase/middleware.ts` | `middleware.ts` session refresh |

Always `getUser()`, never `getSession()`, on the server: it revalidates the token with the auth
server instead of trusting a cookie the caller controls.

`refreshSession()` returns cookies rather than a `Response` (unlike the shape in the Supabase
docs) because `middleware.ts` has to attach the CSP nonce to that same response. Keep it that way.

Note the project rejects signups from non-deliverable email domains, so `@example.com` and similar
placeholders fail with `email_address_invalid` — test with a real address. If "Confirm email" is
enabled (Authentication → Providers → Email), `signUp()` returns a user with **no session**;
`AuthForm` handles that by telling the user to check their inbox.

### Billing / the paywall

$9.99/month via a **Stripe Payment Link** — no Stripe.js, no embedded Checkout. That choice is
why the CSP needed no changes: a Payment Link is a top-level navigation, which CSP doesn't
restrict. The CTA in `components/Paywall.tsx` must stay an `<a href>`; a `<form action="https://…">`
would be blocked by `form-action 'self'`.

**Entitlement is not a column on `profiles`.** `profiles_update_own` allows updating *any column
of your own row*, so a `has_paid` boolean there would be self-grantable from the browser console
with the publishable key. It lives in `public.subscriptions`, which has a select-own policy and
**no insert/update/delete policy at all**. Don't add one.

Three gates, and only the last is security:

| Layer | File | Role |
|---|---|---|
| Session | `middleware.ts` | signed-out → `/login`. Knows nothing about subscriptions — an entitlement query here would cost a DB round trip on every request |
| Page | `app/page.tsx` | unsubscribed → `/paywall`. Advisory UX |
| API | `app/api/tryon/route.ts` | `402`. The real boundary — runs after auth, before the quota check and before `formData()` |

Two write paths, both converging on the idempotent `syncSubscription()` in `lib/entitlement.ts`:

- `app/billing/success/route.ts` — where the Payment Link redirects. Verifies the session against
  the Stripe API and requires `client_reference_id === user.id`, because `session_id` arrives in
  a URL the caller controls. This is the path that works on localhost.
- `app/api/stripe/webhook/route.ts` — the durable one, and the *only* thing that ever learns about
  a renewal, a failed card, or a cancellation. Signature verification is its entire trust
  boundary, so it needs the raw `req.text()` — parsing to JSON first invalidates the signature.
  `middleware.ts` early-returns for this path before `refreshSession()`.

`client_reference_id` on the Payment Link URL is the whole mechanism linking Stripe to Supabase.
Subscription lifecycle events don't carry it (it exists only on the Checkout Session), so
`handleCheckoutCompleted` stamps `metadata.supabase_user_id` onto the subscription, and
`resolveUserId()` falls back to a `stripe_customer_id` lookup.

Two Stripe API details worth not rediscovering:

- As of API version **2026-06-24.dahlia**, `current_period_end` is no longer on the Subscription
  object — it's on each subscription **item**. `periodEnd()` reads the max across items. Don't
  pin an older `apiVersion` to "fix" this.
- `isActive()` excludes `past_due` (a retrying card shouldn't keep spending Gemini credits) but
  allows a **3-day grace past `current_period_end`**, because a renewal only reaches this
  database via a webhook and a delayed delivery would otherwise lock out someone who just paid.

**`SUPABASE_SECRET_KEY` is a deliberate exception** to the rule below that the `service_role` key
must never appear here. The webhook has no session, so there's no `auth.uid()` for RLS to match,
and `subscriptions` has no write policy by design. Its blast radius is contained by import
discipline: `lib/supabase/admin.ts` is imported **only** by the two billing routes. Never import
it from a Server Component, a `"use client"` file, or anything in `components/`.

### Security model

`/api/tryon` requires a session and each call spends real money upstream (Gemini
credits), so the route is the trust boundary. Every client-side check is repeated there —
anything in `page.tsx` is advisory UX, trivially bypassed by POSTing directly.

Enforced in `route.ts`:

- **Auth**, before anything expensive but *after* the IP flood limit — otherwise an
  anonymous flood costs a round trip to the auth server per hit.
- **An active subscription**, immediately after auth and before the quota check, so an
  unpaid account is turned away before any parsing work.
- **Two rate limits** (`lib/rateLimit.ts`). `REQUEST_LIMIT` (60/hr) is keyed by **IP** and
  counts every request so the endpoint can't be hammered with malformed payloads;
  `GENERATION_LIMIT` (8/hr) is keyed by **user id** — quota follows the account, so a shared
  NAT doesn't pool one budget and a user can't reset theirs by switching networks. It is
  *checked* early but only *consumed* immediately before the upstream call, so a validation
  error doesn't cost a user their generation budget. Keep that check/consume split if you
  touch it.
- **Raster types only** — `image/jpeg|png|webp`. Not `image/*`, which would admit
  `image/svg+xml`; SVG can carry scripts and executes when opened as a top-level document,
  which the result panel's Download link permits. This applies to the *upstream response* too.
- **Size caps** — `Content-Length` is rejected before `req.formData()` buffers the body.
- **The outbound payload is rebuilt from scratch**, so a caller can't inject extra form
  fields into the n8n workflow.
- **Upstream error bodies are logged, never returned.** They name internal nodes and
  configuration. Clients get a generic message.

`lib/rateLimit.ts` is in-memory, so on Vercel it's per-instance and resets on cold start —
it raises the cost of casual abuse but is not a hard guarantee. Swap in Vercel KV / Upstash
(atomic `INCR` + `EXPIRE`) for a durable limit; the call signature can stay the same.

### CSP, the nonce, and why the page is `force-dynamic`

`middleware.ts` mints a per-request nonce and sets the CSP; `next.config.ts` carries only the
static headers. These three files are coupled.

Two auth-related constraints on the policy:

- `connect-src` must list `NEXT_PUBLIC_SUPABASE_URL`. The browser client calls Supabase Auth
  directly, so `'self'` alone silently blocks every sign-in.
- `form-action 'self' https://billing.stripe.com` — `'self'` lets the header's sign-out form
  POST to `/auth/signout`. The Stripe origin is there because `/billing/portal` answers with a
  redirect to `billing.stripe.com`, and browsers enforce `form-action` against **every hop of a
  form's redirect chain**, not just the immediate action. Drop it and the Membership button is
  blocked with no visible error — the click just does nothing.

And on the rendering side:

Next.js emits inline `<script>` tags for hydration data. The policy uses
`'nonce-…' 'strict-dynamic'` rather than `'unsafe-inline'`, and Next.js can only stamp that
nonce onto its scripts **while rendering dynamically** — hence `export const dynamic =
"force-dynamic"` in `app/page.tsx`, which is why the UI lives in `components/TryOnApp.tsx`
(route segment config can't be exported from a `"use client"` file).

Remove `force-dynamic` and the page is prerendered without nonces; `strict-dynamic` then
blocks every script and the page loads looking correct but completely inert. **This does not
reproduce in `npm run dev`** — verify CSP changes against `npm run build && npm start`, and
check that the announcement bar countdown is ticking (it only renders after hydration).

`app/login/page.tsx` needs `force-dynamic` for the same reason, and the stakes are higher: an
inert login form is a locked door. Every route must show `ƒ` (Dynamic), not `○`, in the
`npm run build` output. A quick check that the nonce landed:

```bash
curl -s -D /tmp/h -o /tmp/p http://localhost:3000/login
# Both counts must match. Use `grep -o | wc -l`, not `grep -c` — the built HTML is
# a single line, so `grep -c` reports 1 no matter how many script tags there are.
grep -o '<script' /tmp/p | wc -l
grep -o "<script[^>]*nonce=\"$(grep -oiP "nonce-\K[^']+" /tmp/h | head -1)\"" /tmp/p | wc -l
```

### Uploads are downscaled before they leave the browser

`lib/resizeImage.ts` re-encodes each image to max 1600px on the long edge as JPEG via canvas.
This exists because Vercel serverless functions cap request bodies at ~4.5MB and a phone photo plus
a garment shot can exceed it. It is an optimization, never a gate: every failure path returns the
original `File` unchanged. Don't make it throw.

### Object URL lifecycle

Every `URL.createObjectURL` in `page.tsx` has a matching `revokeObjectURL` — on replace, on clear,
on regenerate, and on unmount (via a ref that mirrors the current URLs so the cleanup effect can
stay dependency-free). New object URLs need the same treatment.

## Deployment (Vercel)

Next.js is auto-detected — there is no `vercel.json`, and adding one is not needed.

Seven environment variables must exist in the Vercel project (Production **and** Preview) before
the first build: `TRYON_WEBHOOK_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK`. A missing one fails the build rather
than shipping a broken deploy — `lib/supabase/env.ts`, `lib/stripe.ts`, and
`lib/supabase/admin.ts` all throw at module load, by design.

The Stripe **webhook endpoint URL** and the **Payment Link redirect** are configured in the Stripe
dashboard, not in code, and both hardcode the origin. After any domain change, update them and
check Developers → Webhooks for failed deliveries — a wrong URL means renewals and cancellations
stop reaching the app, silently.

Supabase's Site URL and Redirect URLs (Authentication → URL Configuration) have to include the
deployed origin. Nothing in the code hardcodes an origin, so this is the only place the
deployment's domain is configured — leave it pointing at `localhost` and confirmation emails
send users to a dead link.

Two limits worth knowing before relying on it in production:

- `lib/rateLimit.ts` is in-memory, so limits are **per-instance and reset on cold start**. See
  the security model section — a durable limit needs Vercel KV / Upstash.
- `maxDuration = 60` in `route.ts` is at the Hobby-plan ceiling. A slow generation times out.

`clientKey()` reads `x-forwarded-for`, which is what the Vercel proxy sets, so IP-keyed limiting
works behind it. Don't "fix" it to read a socket address.

## Design system

The UI recreates the visual language of a SKIMS product page (the source screenshot is in the repo
root). Tailwind v4 — there is no `tailwind.config.js`; theme tokens are declared in the `@theme`
block of `app/globals.css`:

| Token | Value | Use |
|---|---|---|
| `ink` | `#000000` | Text, buttons |
| `muted` | `#767676` | Secondary text, placeholders |
| `hairline` | `#e5e5e5` | Row dividers, borders, disabled button fill |
| `well` | `#f0f0f0` | Upload zones, result panel |

Constraints that matter:

- **Zero border radius everywhere.** `globals.css` enforces this with a global `border-radius: 0`
  rule. Don't add `rounded-*` utilities.
- Monochrome only — there is no red, so errors are communicated through copy and a hairline-bordered
  strip, not color.
- Headings and labels are uppercase with wide tracking. Long error text is an exception: it renders
  in normal case under an uppercase heading, because uppercase sentences are unreadable.
- The wordmark is **ATELIER**, deliberately not the SKIMS logo.
