# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
cp .env.example .env.local   # first-time setup; fill in TRYON_WEBHOOK_URL + the two Supabase vars
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

### Security model

`/api/tryon` requires a session and each call spends real money upstream (Gemini
credits), so the route is the trust boundary. Every client-side check is repeated there —
anything in `page.tsx` is advisory UX, trivially bypassed by POSTing directly.

Enforced in `route.ts`:

- **Auth**, before anything expensive but *after* the IP flood limit — otherwise an
  anonymous flood costs a round trip to the auth server per hit.
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
- `form-action 'self'` is what lets the header's sign-out form POST to `/auth/signout`.

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
grep -c '<script' /tmp/p                                   # must equal the nonce'd count below
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
