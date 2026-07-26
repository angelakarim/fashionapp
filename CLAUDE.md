# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
cp .env.example .env.local   # first-time setup; fill in TRYON_WEBHOOK_URL
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
