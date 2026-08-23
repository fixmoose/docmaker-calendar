"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { rememberNext } from "@/lib/next-url";
import { publicUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/client";
import { Button, Field, inputClass } from "./ui";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.5 5.5 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.94-2.93l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.27a7.2 7.2 0 0 1 0-4.54V6.64H1.28a12 12 0 0 0 0 10.72l4.01-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.28 6.64l4.01 3.09C6.23 6.86 8.88 4.75 12 4.75Z"
      />
    </svg>
  );
}

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/calendar";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [checkEmail, setCheckEmail] = useState(false);

  const isSignup = mode === "signup";

  const withGoogle = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // Where to land afterwards is remembered here rather than sent as a query
    // string: Supabase matches the redirect against an allow-list, and an
    // entry without a wildcard will not match a URL that carries a query.
    rememberNext(next);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${publicUrl()}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  const withEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();

    rememberNext(next);

    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name.trim() || email.split("@")[0] },
          emailRedirectTo: `${publicUrl()}/auth/callback`,
        },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      // With email confirmation on, there is no session until they click through.
      if (!data.session) {
        setCheckEmail(true);
        setBusy(false);
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    }

    router.push(next);
    router.refresh();
  };

  if (checkEmail) {
    return (
      <div className="text-center">
        <CheckCircle2 size={30} className="mx-auto text-brand" />
        <h1 className="mt-4 text-[20px] font-bold tracking-tight text-ink">
          Check your inbox
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
          We sent a confirmation link to <strong className="text-ink">{email}</strong>.
          Open it and you are in.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex text-[13px] font-medium text-brand hover:underline"
        >
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center">
        <Image
          src="/logo-mark.png"
          alt=""
          width={44}
          height={44}
          className="mx-auto h-11 w-11"
        />
        <h1 className="mt-4 text-[22px] font-bold tracking-tight text-ink">
          {isSignup ? "Create your calendar" : "Welcome back"}
        </h1>
        <p className="mt-1.5 text-[14px] text-ink-muted">
          {isSignup
            ? "Share the plans that matter, keep the rest private."
            : "Log in to DocMaker Calendar."}
        </p>
      </div>

      <button
        type="button"
        onClick={withGoogle}
        disabled={busy}
        className="mt-6 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-line bg-surface text-[14px] font-medium text-ink transition hover:bg-surface-2 disabled:opacity-60"
      >
        <GoogleMark />
        Continue with Google
      </button>

      <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-faint">
        Google will ask you to continue to DocMaker Calendar. We only ever see
        your name, email and picture.
      </p>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] tracking-wide text-ink-faint uppercase">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={withEmail} className="space-y-3">
        {isSignup && (
          <Field label="Your name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dejan"
              autoComplete="name"
              className={inputClass}
            />
          </Field>
        )}

        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className={inputClass}
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? "At least 8 characters" : "Your password"}
            autoComplete={isSignup ? "new-password" : "current-password"}
            className={inputClass}
          />
        </Field>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[#d1443c]/30 bg-[#d1443c]/8 px-3 py-2 text-[12px] text-[#d1443c]">
            <TriangleAlert size={14} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          variant="primary"
          className="h-11 w-full justify-center text-[15px]"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault();
            void withEmail(e as unknown as React.FormEvent);
          }}
        >
          {busy ? "One moment…" : isSignup ? "Create account" : "Log in"}
        </Button>
      </form>

      <p className="mt-5 text-center text-[13px] text-ink-muted">
        {isSignup ? "Already have an account?" : "New here?"}{" "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="font-medium text-brand hover:underline"
        >
          {isSignup ? "Log in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}
