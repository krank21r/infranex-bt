"use client";

// ADMINPANEL-1 — credential management, visible ONLY to the admin user.
// The sidebar entry is gated on the session role, the view re-checks it,
// and every /api/admin/users call enforces role === "admin" server-side.
// Viewing codes is possible because they are stored AES-256-GCM encrypted
// (codeEnc); verification still uses the one-way scrypt hash.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AdminUser {
  userId: string;
  label: string;
  role: string;
  active: boolean;
  code: string | null; // null → legacy row without an encrypted copy
  lastLoginAt: string | null;
  createdAt: string;
}

interface RegenerateState {
  userId: string;
  code: string;
}

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      })
    : "never";

export function AdminView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [fresh, setFresh] = useState<RegenerateState | null>(null);

  const usersQ = useQuery<{ users: AdminUser[] }>({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.status === 403) throw new Error("Admin privileges required.");
      if (!res.ok) throw new Error(`admin/users ${res.status}`);
      return res.json();
    },
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const regenerateMut = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate", userId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `regenerate ${res.status}`);
      return j as { userId: string; code: string };
    },
    onSuccess: (data) => {
      setFresh({ userId: data.userId, code: data.code });
      setRevealed((r) => ({ ...r, [data.userId]: true }));
      invalidate();
      toast({ title: `${data.userId} has a new access code`, description: "Copy it now — both credential files were updated." });
    },
    onError: (e: Error) =>
      toast({ title: "Regeneration failed", description: e.message, variant: "destructive" }),
  });

  const activeMut = useMutation({
    mutationFn: async (p: { userId: string; active: boolean }) => {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setActive", ...p }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `setActive ${res.status}`);
      return j as { userId: string; active: boolean };
    },
    onSuccess: (data) => {
      invalidate();
      toast({
        title: `${data.userId} ${data.active ? "re-enabled" : "disabled"}`,
        description: data.active ? "Sign-in allowed again." : "Sign-in is now rejected.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied((c) => (c === tag ? null : c)), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Select the code manually.", variant: "destructive" });
    }
  };

  const users = usersQ.data?.users ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/60 p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-display text-lg font-bold leading-tight">Access control</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                View current access codes, issue new ones, or disable an operator. Only the
                admin account can open this panel — the server enforces the role on every
                request. Verification stays one-way (scrypt); display is possible because the
                code is also stored AES-256-GCM encrypted.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5 text-[11px]">
            <ShieldQuestion className="h-3 w-3" /> admin only
          </Badge>
        </div>
      </div>

      {/* Fresh-code banner — shown once after a regeneration */}
      {fresh && (
        <div className="rounded-2xl border border-primary/40 bg-primary/[0.07] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-display text-sm font-semibold">
                New access code for <span className="mono">{fresh.userId}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                The previous code no longer works. Credential files were re-mirrored automatically.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="mono rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-sm tracking-wider">
                {fresh.code}
              </code>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => copy(fresh.code, "fresh")}>
                {copied === "fresh" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                {copied === "fresh" ? "Copied" : "Copy"}
              </Button>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setFresh(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span className="text-display text-sm font-semibold">Operator credentials</span>
            <Badge variant="outline" className="text-[10px]">{users.length}</Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              const all = users.every((u) => revealed[u.userId]);
              const next: Record<string, boolean> = {};
              for (const u of users) next[u.userId] = !all;
              setRevealed(next);
            }}
          >
            {users.length > 0 && users.every((u) => revealed[u.userId]) ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            {users.length > 0 && users.every((u) => revealed[u.userId]) ? "Hide all codes" : "Reveal all codes"}
          </Button>
        </div>

        {usersQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading credentials…
          </div>
        ) : usersQ.isError ? (
          <div className="px-5 py-10 text-center text-sm text-destructive">
            {(usersQ.error as Error).message}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground/70">
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-4 py-2.5 font-medium">Access code</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Last sign-in</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const shown = revealed[u.userId];
                  return (
                    <tr key={u.userId} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 bg-background/50 text-[11px] font-semibold text-primary">
                            {u.label.replace(/[^a-zA-Z0-9]/g, " ").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="mono text-[13px] font-semibold leading-tight">{u.userId}</p>
                            <p className="text-xs text-muted-foreground">{u.label}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {u.code ? (
                          <div className="flex items-center gap-1.5">
                            <code className="mono rounded-md border border-border/50 bg-background/50 px-2 py-1 text-[12px] tracking-wider">
                              {shown ? u.code : "••••-••••-••••-••••"}
                            </code>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setRevealed((r) => ({ ...r, [u.userId]: !shown }))}
                              aria-label={shown ? "Hide code" : "Reveal code"}
                            >
                              {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => copy(u.code!, u.userId)}
                              aria-label="Copy code"
                            >
                              {copied === u.userId ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground/70">
                            hidden (legacy) — regenerate to restore
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={u.role === "admin" ? "default" : "outline"} className="text-[10px] uppercase tracking-wide">
                          {u.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn("flex items-center gap-1.5 text-xs font-medium", u.active ? "text-success" : "text-muted-foreground")}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", u.active ? "bg-success" : "bg-muted-foreground/50")} />
                          {u.active ? "active" : "disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground tabular">
                        {fmtDate(u.lastLoginAt)}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            disabled={regenerateMut.isPending}
                            onClick={() => {
                              if (confirm(`Regenerate the access code for "${u.userId}"? The current code stops working immediately.`)) {
                                regenerateMut.mutate(u.userId);
                              }
                            }}
                          >
                            {regenerateMut.isPending && regenerateMut.variables === u.userId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCcw className="h-3.5 w-3.5" />
                            )}
                            Regenerate
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-8 gap-1.5 text-xs", !u.active && "text-success")}
                            disabled={activeMut.isPending || u.role === "admin"}
                            title={u.role === "admin" ? "The admin account cannot be disabled" : undefined}
                            onClick={() => {
                              const verb = u.active ? "disable" : "re-enable";
                              if (confirm(`${verb} "${u.userId}"?`)) {
                                activeMut.mutate({ userId: u.userId, active: !u.active });
                              }
                            }}
                          >
                            {u.active ? (
                              <>
                                <ShieldOff className="h-3.5 w-3.5" /> Disable
                              </>
                            ) : (
                              <>
                                <ShieldCheck className="h-3.5 w-3.5" /> Enable
                              </>
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground/70">
        Codes are mirrored to <span className="mono">scripts/users.local.json</span> and a
        wipe-proof copy under <span className="mono">/tmp/my-project/</span> on every change.
        Disabled operators cannot sign in until re-enabled.
      </p>
    </div>
  );
}
