import TryOnApp from "@/components/TryOnApp";

/**
 * Rendered per request rather than prerendered at build time.
 *
 * The CSP in middleware.ts mints a fresh nonce for every request, and Next.js
 * can only stamp that nonce onto its inline hydration scripts while rendering
 * dynamically. A statically prerendered page would ship without nonces, and
 * 'strict-dynamic' would then block every script — leaving the page inert.
 *
 * The cost is negligible here: the UI below is a client component that does
 * all of its work in the browser.
 */
export const dynamic = "force-dynamic";

export default function Page() {
  return <TryOnApp />;
}
