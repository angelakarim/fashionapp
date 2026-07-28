import AnnouncementBar from "@/components/AnnouncementBar";
import SiteHeader from "@/components/SiteHeader";

const FEATURES = [
  "Unlimited virtual try-on generations",
  "Full-resolution downloads",
  "New garment models as they ship",
  "Cancel anytime",
];

export default function Paywall({
  displayName,
  checkoutUrl,
  pending = false,
}: {
  displayName: string;
  checkoutUrl: string;
  pending?: boolean;
}) {
  return (
    <main className="min-h-screen">
      <AnnouncementBar />
      <SiteHeader displayName={displayName} />

      <div className="px-6 pt-10 pb-6">
        <h1 className="text-4xl font-bold tracking-tight uppercase">
          Membership Required
        </h1>
        <p className="mt-3 text-[15px] text-ink">
          Your account is ready. Subscribe to start generating try-ons.
        </p>
        <nav className="mt-4 text-sm text-muted" aria-label="Breadcrumb">
          <span>Home</span>
          <span className="px-2">/</span>
          <span>Membership</span>
        </nav>
      </div>

      {pending && (
        <div className="mx-6 mb-6 border border-hairline px-5 py-4" role="status">
          <p className="text-xs font-bold tracking-widest uppercase">
            Payment not confirmed
          </p>
          <p className="mt-2 text-sm text-muted">
            We could not confirm your payment yet. If you have just paid, wait a
            moment and refresh this page. Nothing has been charged twice.
          </p>
        </div>
      )}

      <div className="border-t border-b border-hairline px-6 py-4">
        <div className="flex flex-wrap items-center gap-8 text-xs font-medium tracking-widest uppercase">
          <span>Full Access</span>
          <span>Billed Monthly</span>
          <span>Cancel Anytime</span>
        </div>
      </div>

      <div className="px-6 py-10">
        <div className="mx-auto max-w-[520px] border border-hairline">
          <div className="border-b border-hairline bg-well px-8 py-10 text-center">
            <p className="text-xs font-bold tracking-widest uppercase">
              ATELIER Membership
            </p>
            <p className="mt-6 text-6xl font-bold tracking-tight">$9.99</p>
            <p className="mt-3 text-xs font-medium tracking-widest text-muted uppercase">
              Per Month
            </p>
          </div>

          <ul className="px-8 py-2">
            {FEATURES.map((feature) => (
              <li
                key={feature}
                className="border-b border-hairline py-4 text-[15px] last:border-b-0"
              >
                {feature}
              </li>
            ))}
          </ul>

          <div className="px-8 pt-2 pb-8">
            {/* A plain anchor, not a form: `form-action 'self'` in the CSP
                would block a POST to Stripe, while a top-level navigation is
                not something CSP restricts. */}
            <a
              href={checkoutUrl}
              className="flex w-full items-center justify-center bg-ink px-12 py-4 text-xs font-bold tracking-widest text-white uppercase hover:opacity-85"
            >
              Subscribe — $9.99 / Month
            </a>
            <p className="mt-3 text-center text-xs text-muted">
              Secure checkout by Stripe. Cancel anytime.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
