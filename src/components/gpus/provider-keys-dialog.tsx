"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  CircleCheck,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

/**
 * Provider API Keys — add/update/test/remove GPU marketplace API keys
 * (RunPod, Vast.ai, Lambda Labs) from the GPU catalog. Keys are stored
 * server-side encrypted; this dialog only ever receives a masked hint.
 */

interface ProviderKeyEntry {
  id: string;
  provider: string;
  label: string;
  offers: boolean;
  rent: boolean;
  keyHint: string;
  note: string | null;
  hasKey: boolean;
  maskedKey: string | null;
  status: string | null;
  statusMessage: string | null;
  lastCheckedAt: string | null;
}

interface KeysResponse {
  keys: ProviderKeyEntry[];
}

const STATUS_STYLES: Record<string, string> = {
  valid: "border-success/40 bg-success/10 text-success",
  invalid: "border-destructive/40 bg-destructive/10 text-destructive",
  error: "border-warning/40 bg-warning/10 text-warning",
  unverified: "border-border/60 bg-muted/40 text-muted-foreground",
};

function StatusPill({ status }: { status: string | null }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <ShieldQuestion className="h-3 w-3" /> Not set
      </span>
    );
  }
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.unverified;
  const label =
    status === "valid"
      ? "Valid"
      : status === "invalid"
        ? "Rejected"
        : status === "error"
          ? "Check failed"
          : "Unverified";
  const Icon =
    status === "valid" ? ShieldCheck : status === "unverified" ? ShieldQuestion : ShieldAlert;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", style)}>
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}

export function ProviderKeysDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const keysQuery = useQuery<KeysResponse>({
    queryKey: ["provider-keys"],
    queryFn: async () => {
      const res = await fetch("/api/providers/keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`provider-keys ${res.status}`);
      return res.json();
    },
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["provider-keys"] });
    qc.invalidateQueries({ queryKey: ["gpu-offers"] });
  };

  const saveMut = useMutation({
    mutationFn: async (p: { provider: string; key: string }) => {
      const res = await fetch("/api/providers/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `save ${res.status}`);
      return j as { key: ProviderKeyEntry; check: { ok: boolean; status: string; message: string } };
    },
    onSuccess: (data) => {
      invalidate();
      setDrafts((d) => ({ ...d, [data.key.provider]: "" }));
      if (data.check.status === "valid") {
        toast({ title: `${data.key.label} key verified`, description: `${data.check.message} Live offers are flowing.` });
      } else {
        toast({
          title: `${data.key.label} key saved — but the provider rejected it`,
          description: data.check.message,
          variant: "destructive",
        });
      }
    },
    onError: (e: Error) => toast({ title: "Could not save the key", description: e.message, variant: "destructive" }),
  });

  const testMut = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch("/api/providers/keys/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `test ${res.status}`);
      return j as { check: { ok: boolean; status: string; message: string } };
    },
    onSuccess: (data) => {
      invalidate();
      if (data.check.ok) {
        toast({ title: "Key check passed", description: data.check.message });
      } else {
        toast({ title: "Key check failed", description: data.check.message, variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Key check failed", description: e.message, variant: "destructive" }),
  });

  const removeMut = useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(`/api/providers/keys?provider=${provider}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`remove ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Key removed", description: "The provider falls back to indicative pricing." });
    },
    onError: (e: Error) => toast({ title: "Could not remove the key", description: e.message, variant: "destructive" }),
  });

  const busy = saveMut.isPending || testMut.isPending || removeMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" /> Provider API keys
          </DialogTitle>
          <DialogDescription>
            Connect GPU marketplaces to pull live pricing into the catalog and the deploy wizard.
            Each key is validated the moment you save it.
          </DialogDescription>
        </DialogHeader>

        {keysQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
          </div>
        ) : (
          <div className="space-y-3">
            {(keysQuery.data?.keys ?? []).map((entry) => {
              const connectable = entry.offers || entry.rent;
              const draft = drafts[entry.id] ?? "";
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "rounded-lg border bg-card/30 p-3",
                    !connectable && "opacity-70"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{entry.label}</span>
                    {entry.rent ? (
                      <Badge variant="outline" className="border-primary/40 text-primary">Real rental</Badge>
                    ) : entry.offers ? (
                      <Badge variant="outline" className="border-border/60 text-muted-foreground">Live pricing</Badge>
                    ) : (
                      <Badge variant="outline" className="border-border/60 text-muted-foreground">Catalog only</Badge>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      <StatusPill status={entry.hasKey ? entry.status : null} />
                      {entry.hasKey && entry.maskedKey && (
                        <span className="font-mono text-xs text-muted-foreground">{entry.maskedKey}</span>
                      )}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">{entry.note ?? entry.keyHint}</p>

                  {entry.hasKey && entry.statusMessage && (
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        entry.status === "valid"
                          ? "text-success"
                          : entry.status === "invalid"
                            ? "text-destructive"
                            : "text-warning"
                      )}
                    >
                      {entry.statusMessage}
                      {entry.lastCheckedAt && (
                        <span className="text-muted-foreground">
                          {" "}· checked {new Date(entry.lastCheckedAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                  )}

                  {connectable && (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <Input
                        type="password"
                        placeholder={entry.hasKey ? "Paste a new key to replace…" : `Paste your ${entry.label} API key…`}
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [entry.id]: e.target.value }))}
                        className="h-9 flex-1 font-mono text-xs"
                        autoComplete="off"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-9"
                          disabled={busy || draft.trim().length === 0}
                          onClick={() =>
                            saveMut.mutate({ provider: entry.id, key: draft.trim() })
                          }
                        >
                          {saveMut.isPending && saveMut.variables?.provider === entry.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : entry.hasKey ? (
                            "Update"
                          ) : (
                            "Save & verify"
                          )}
                        </Button>
                        {entry.hasKey && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9"
                              disabled={busy}
                              onClick={() => testMut.mutate(entry.id)}
                            >
                              {testMut.isPending && testMut.variables === entry.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                              Test
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 text-destructive hover:text-destructive"
                              disabled={busy}
                              onClick={() => removeMut.mutate(entry.id)}
                            >
                              {removeMut.isPending && removeMut.variables === entry.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <Separator />
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          Keys are AES-256-GCM encrypted at rest, used only by the server to call the
          provider APIs, and never displayed in full again. Removing a key immediately
          falls that provider back to indicative pricing.
        </p>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Keys live in this platform only — they are never sent to the browser, never
          logged, and never shared with the GPU machines you rent.
        </p>
      </DialogContent>
    </Dialog>
  );
}
