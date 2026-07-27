import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * POST-only: a GET sign-out could be triggered by any <img> or link pointing
 * here, letting a third-party page log the user out.
 */
export async function POST(req: Request) {
  const supabase = await createClient();

  // Ignore the result — if the token is already gone the user is signed out
  // either way, and the redirect below is the same.
  await supabase.auth.signOut();

  return NextResponse.redirect(new URL("/login", req.url), {
    // 303 so the browser follows with GET rather than replaying the POST.
    status: 303,
  });
}
