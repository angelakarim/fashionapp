export const runtime = "nodejs";
export const maxDuration = 60;

const WEBHOOK_URL = process.env.TRYON_WEBHOOK_URL;

/**
 * n8n reports failures as JSON. Pull out the human-readable bits rather than
 * dumping a raw payload into the UI.
 */
function describe(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const parts = [parsed?.message, parsed?.hint].filter(
      (p): p is string => typeof p === "string" && p.length > 0
    );
    if (parts.length) return parts.join(" ").slice(0, 400);
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return raw.slice(0, 400);
}

/**
 * Server-side proxy to the n8n generation webhook.
 *
 * Going through the server rather than calling n8n from the browser means we
 * don't depend on n8n returning CORS headers, and the webhook URL never ships
 * to the client. The upstream body (a binary image) is streamed straight back.
 */
export async function POST(req: Request) {
  if (!WEBHOOK_URL) {
    return new Response("TRYON_WEBHOOK_URL is not configured.", {
      status: 500,
    });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("Could not read the uploaded images.", { status: 400 });
  }

  if (!(form.get("image1") instanceof File) || !(form.get("image2") instanceof File)) {
    return new Response("Both images are required.", { status: 400 });
  }

  let upstream: Response;
  try {
    // Re-sending the parsed FormData lets fetch generate a fresh multipart
    // boundary rather than reusing the incoming request's.
    upstream = await fetch(WEBHOOK_URL, { method: "POST", body: form });
  } catch {
    return new Response(
      "Could not reach the generation service. Check that the n8n workflow is listening.",
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const raw = await upstream.text().catch(() => "");
    if (upstream.status === 404) {
      return new Response(
        "The webhook is not registered. Open the n8n workflow and click “Execute workflow” to arm the test webhook, then try again.",
        { status: 502 }
      );
    }
    return new Response(
      `Generation service returned ${upstream.status}. ${describe(raw)}`.trim(),
      { status: 502 }
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "image/png";

  // n8n answers with JSON when a node fails, so surface that as an error
  // instead of handing a JSON blob to an <img> tag.
  if (!contentType.startsWith("image/")) {
    const raw = await upstream.text().catch(() => "");
    return new Response(
      `The generation service did not return an image. ${describe(raw)}`.trim(),
      { status: 502 }
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
