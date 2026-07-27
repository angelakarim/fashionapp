"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

/** Matches the minimum Supabase enforces, so the error surfaces before the round trip. */
const MIN_PASSWORD = 6;

const FIELD =
  "w-full border border-hairline bg-white px-4 py-3 text-[15px] outline-none focus:border-ink";
const LABEL = "block text-xs font-bold tracking-widest uppercase";

export default function AuthForm({ next }: { next: string }) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (to: Mode) => {
    setMode(to);
    setError(null);
    setNotice(null);
    setPassword("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (mode === "signup" && name.trim().length === 0) {
      setError("Please enter your name.");
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Your password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    try {
      if (mode === "signup") {
        // `data.name` lands on raw_user_meta_data, which the on_auth_user_created
        // trigger copies into public.profiles.
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { name: name.trim() } },
        });
        if (error) throw error;

        // With "Confirm email" enabled, signUp returns a user but no session —
        // the account is not usable until the emailed link is clicked.
        if (!data.session) {
          setNotice(
            "Check your inbox to confirm your email address, then sign in."
          );
          setMode("signin");
          setPassword("");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }

      // refresh() re-runs the server components so the header picks up the
      // new session; push() alone would serve them from the router cache.
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Please try again."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const isSignUp = mode === "signup";

  return (
    <div className="mx-auto w-full max-w-[420px]">
      {/* Mode switch — mirrors the filter bar's uppercase tab row */}
      <div className="flex border-b border-hairline">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            aria-pressed={mode === m}
            className={[
              "flex-1 px-4 py-4 text-xs font-bold tracking-widest uppercase",
              mode === m
                ? "border-b-2 border-ink text-ink"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {m === "signin" ? "Sign In" : "Create Account"}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
        {isSignUp && (
          <div>
            <label htmlFor="name" className={LABEL}>
              Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              disabled={isLoading}
              className={`mt-2 ${FIELD}`}
            />
          </div>
        )}

        <div>
          <label htmlFor="email" className={LABEL}>
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            disabled={isLoading}
            className={`mt-2 ${FIELD}`}
          />
        </div>

        <div>
          <label htmlFor="password" className={LABEL}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            required
            minLength={MIN_PASSWORD}
            disabled={isLoading}
            className={`mt-2 ${FIELD}`}
          />
          {isSignUp && (
            <p className="mt-2 text-xs text-muted">
              At least {MIN_PASSWORD} characters.
            </p>
          )}
        </div>

        {/* Monochrome palette — problems are communicated by copy, not colour. */}
        {error && (
          <div role="alert" className="border border-hairline px-5 py-4">
            <p className="text-xs font-bold tracking-widest uppercase">
              {isSignUp ? "Could not create account" : "Could not sign in"}
            </p>
            <p className="mt-2 text-sm text-muted">{error}</p>
          </div>
        )}

        {notice && (
          <div role="status" className="border border-hairline px-5 py-4">
            <p className="text-xs font-bold tracking-widest uppercase">
              Almost there
            </p>
            <p className="mt-2 text-sm text-muted">{notice}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className={[
            "mt-1 w-full px-12 py-4 text-xs font-bold tracking-widest uppercase",
            isLoading
              ? "cursor-not-allowed bg-hairline text-muted"
              : "bg-ink text-white hover:opacity-85",
          ].join(" ")}
        >
          {isLoading
            ? isSignUp
              ? "Creating account…"
              : "Signing in…"
            : isSignUp
              ? "Create Account"
              : "Sign In"}
        </button>
      </form>
    </div>
  );
}
