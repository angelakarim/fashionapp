import { checkLimit, consumeLimit, clientKey } from "@/lib/rateLimit";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const WEBHOOK_URL = process.env.TRYON_WEBHOOK_URL;

/** Per-image cap. Two of these must still fit Vercel's ~4.5MB body limit. */
const MAX_FILE_BYTES = 6 * 1024 * 1024;
/** Whole-request cap, checked from Content-Length before buffering anything. */
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

/**
 * Two limits, because they defend different things.
 *
 * GENERATION_LIMIT is spent only when a request actually reaches n8n — that is
 * the call that costs money, and a user who picks the wrong file type
 * shouldn't lose generation budget to a validation error.
 *
 * REQUEST_LIMIT covers every request including rejected ones, so the endpoint
 * can't be hammered for free with malformed payloads.
 */
const GENERATION_LIMIT = 8;
const REQUEST_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Raster formats only. `image/*` would also admit image/svg+xml, which can
 * carry scripts and executes if the image is ever opened as a top-level
 * document — which the result panel's Download link allows.
 */
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isAllowedImage(type: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(type.split(";")[0]!.trim().toLowerCase());
}

function fail(message: string, status: number, extraHeaders?: HeadersInit) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

/**
 * Server-side proxy to the n8n generation webhook.
 *
 * The browser never calls n8n directly: the webhook URL stays server-side and
 * we don't depend on n8n returning CORS headers. This endpoint is also the only
 * place that can enforce limits — every client-side check (file type, size)
 * is trivially bypassed by POSTing here directly, so all of them are repeated
 * server-side rather than trusted.
 */
export async function POST(req: Request) {
  if (!WEBHOOK_URL) {
    // Deliberately vague: don't disclose configuration state to callers.
    console.error("[tryon] TRYON_WEBHOOK_URL is not set");
    return fail("The service is not available right now.", 503);
  }

  // Keyed by IP and applied before the auth lookup, so an anonymous flood is
  // turned away without spending a round trip to the auth server on each hit.
  const ip = clientKey(req);

  const flood = consumeLimit(`req:${ip}`, REQUEST_LIMIT, RATE_WINDOW_MS);
  if (!flood.ok) {
    return fail("Too many requests. Please try again later.", 429, {
      "Retry-After": String(flood.retryAfterSeconds),
    });
  }

  // Generation costs real money upstream (Gemini credits), so the endpoint is
  // restricted to signed-in users. getUser() revalidates the token against the
  // auth server rather than trusting the cookie, which a caller controls.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return fail("Please sign in to generate a try-on.", 401);
  }

  // Quota follows the account, not the IP: a shared office NAT shouldn't pool
  // one budget, and a user shouldn't reset theirs by switching networks.
  const client = user.id;

  // Checked (not spent) up front so an over-quota caller is turned away before
  // uploading megabytes. The slot is consumed just before the upstream call.
  const quota = checkLimit(`gen:${client}`, GENERATION_LIMIT, RATE_WINDOW_MS);
  if (!quota.ok) {
    return fail(
      "You've reached the generation limit. Please wait a while before trying again.",
      429,
      { "Retry-After": String(quota.retryAfterSeconds) }
    );
  }

  // Reject oversized bodies before req.formData() buffers them into memory.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_TOTAL_BYTES) {
    return fail("Those images are too large.", 413);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Could not read the uploaded images.", 400);
  }

  const image1 = form.get("image1");
  const image2 = form.get("image2");

  if (!(image1 instanceof File) || !(image2 instanceof File)) {
    return fail("Both images are required.", 400);
  }

  for (const file of [image1, image2]) {
    if (!isAllowedImage(file.type)) {
      return fail("Images must be JPEG, PNG, or WebP.", 415);
    }
    if (file.size === 0) {
      return fail("One of the images is empty.", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return fail("Those images are too large.", 413);
    }
  }

  if (image1.size + image2.size > MAX_TOTAL_BYTES) {
    return fail("Those images are too large.", 413);
  }

  // Rebuild the payload from scratch rather than forwarding the caller's
  // FormData, so arbitrary extra fields can't be injected into the workflow.
  const outbound = new FormData();
  outbound.append("image1", image1, "image1.jpg");
  outbound.append("image2", image2, "image2.jpg");

  // Payload is valid and we're about to spend real money — take the slot now.
  const spend = consumeLimit(`gen:${client}`, GENERATION_LIMIT, RATE_WINDOW_MS);
  if (!spend.ok) {
    return fail(
      "You've reached the generation limit. Please wait a while before trying again.",
      429,
      { "Retry-After": String(spend.retryAfterSeconds) }
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(WEBHOOK_URL, {
      method: "POST",
      body: outbound,
      signal: AbortSignal.timeout(55_000),
    });
  } catch (e) {
    console.error("[tryon] upstream request failed:", e);
    return fail("Could not reach the generation service. Please try again.", 502);
  }

  if (!upstream.ok) {
    // Upstream error bodies name internal nodes and configuration, so they are
    // logged server-side and never echoed to the client.
    const detail = await upstream.text().catch(() => "");
    console.error(`[tryon] upstream ${upstream.status}:`, detail.slice(0, 1000));

    if (upstream.status === 404) {
      return fail(
        "The generation service is not available. If you are the site owner, check that the n8n workflow is active.",
        502
      );
    }
    return fail("The generation service could not process that request.", 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "";

  // n8n reports node failures as a 200 with a JSON body, so the response type
  // is verified before it reaches an <img>.
  if (!isAllowedImage(contentType)) {
    const detail = await upstream.text().catch(() => "");
    console.error("[tryon] non-image upstream response:", detail.slice(0, 1000));
    return fail("The generation service did not return an image.", 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline; filename=\"virtual-try-on\"",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

/** Only POST is meaningful here; anything else gets a clean 405. */
export async function GET() {
  return fail("Method not allowed.", 405, { Allow: "POST" });
}
