import AnnouncementBar from "@/components/AnnouncementBar";
import AuthForm from "@/components/AuthForm";

/**
 * Dynamic for the same reason as the home page: the CSP nonce minted in
 * middleware.ts can only be stamped onto Next.js's inline hydration scripts
 * during a dynamic render. Prerendered, this page would load inert — and an
 * inert login form is a locked door.
 */
export const dynamic = "force-dynamic";

/**
 * Only same-origin relative paths are accepted, so a crafted
 * `?next=https://evil.example` can't turn the login page into an open redirect.
 */
function safeNext(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <main className="min-h-screen">
      <AnnouncementBar />

      <header className="border-b border-hairline">
        <div className="flex items-center justify-center px-6 py-4">
          <span className="text-2xl font-black italic tracking-tight">
            ATELIER
          </span>
        </div>
      </header>

      <div className="px-6 py-16">
        <div className="mx-auto w-full max-w-[420px] text-center">
          <h1 className="text-3xl font-bold tracking-tight uppercase">
            Your Account
          </h1>
          <p className="mt-3 text-[15px] text-muted">
            Sign in to use the virtual try-on studio.
          </p>
        </div>

        <div className="mt-10">
          <AuthForm next={safeNext(params.next)} />
        </div>
      </div>
    </main>
  );
}
