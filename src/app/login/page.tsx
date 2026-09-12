"use client";

// AUTH-1 — gated sign-in screen. The ONLY public page in the app.
// Credentials are issued by the administrator (5 seeded users, ID + code);
// there is no self-signup, no reset flow. On success the session cookie is
// set server-side and the browser continues to the app.

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Hexagon, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") || "/";

  const [userId, setUserId] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Sign-in failed — try again.");
        setBusy(false);
        return;
      }
      // Full navigation so the proxy sees the fresh cookie immediately.
      window.location.replace(nextPath.startsWith("/") ? nextPath : "/");
    } catch {
      setError("Network error — is the server reachable?");
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Ambient backdrop — same visual language as the dashboard */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(60rem 40rem at 70% -10%, hsl(var(--primary) / 0.12), transparent 60%), radial-gradient(50rem 35rem at 10% 110%, hsl(var(--primary) / 0.08), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border/60 bg-card/60 shadow-sm">
            <Hexagon className="h-8 w-8 text-primary" strokeWidth={1.6} />
            <span className="absolute inset-0 flex items-center justify-center mono text-sm font-bold text-primary">
              IX
            </span>
          </div>
          <h1 className="text-display text-2xl font-bold tracking-tight">
            INFRANEX <span className="text-primary">BT</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Bittensor Subnet Intelligence Platform
          </p>
        </div>

        {/* Sign-in card */}
        <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-lg backdrop-blur-xl sm:p-8">
          <div className="mb-6 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h2 className="text-display text-lg font-semibold">Operator sign-in</h2>
          </div>

          <form onSubmit={submit} className="space-y-4" autoComplete="off">
            <div className="space-y-1.5">
              <Label htmlFor="userId">User ID</Label>
              <Input
                id="userId"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g. admin"
                className="mono h-10 rounded-lg border-border/60 bg-background/50"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="code">Access code</Label>
              <div className="relative">
                <Input
                  id="code"
                  type={showCode ? "text" : "password"}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="mono h-10 rounded-lg border-border/60 bg-background/50 pr-10 tracking-wider"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowCode((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showCode ? "Hide access code" : "Show access code"}
                  tabIndex={-1}
                >
                  {showCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <Button type="submit" className="h-10 w-full rounded-lg" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          Authorized operators only · access is logged · codes are issued by the administrator
        </p>
      </div>
    </div>
  );
}
