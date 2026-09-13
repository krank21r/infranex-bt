"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { History, RotateCw, Loader2, GitBranch } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatRelativeTime } from "@/lib/utils";

/**
 * TIER2 — deployment config revision history + rollback (spec §20/§25).
 *
 * Shows the append-only revision chain (deploy / drift / runtime-opt /
 * rollback backups) and lets the operator restore any prior revision. The
 * rollback RESTORES the config platform-side and pushes apply_config to the
 * GPU (daemon) or ticks the deployment (mock) — the same transports the
 * engine's own remediations use.
 */

interface RevisionDTO {
  id: string;
  rev: number;
  cause: string;
  note: string;
  actor: string;
  createdAt: string;
  summary: string;
  isCurrent: boolean;
}

const CAUSE_CHIP: Record<string, string> = {
  deploy: "border-primary/40 text-primary",
  drift: "border-cyan-500/40 text-cyan-600 dark:text-cyan-400",
  "runtime-opt": "border-fuchsia-500/40 text-fuchsia-600 dark:text-fuchsia-400",
  "rollback-backup": "border-amber-500/40 text-amber-600 dark:text-amber-400",
};

export function RevisionsDialog({
  deploymentId,
  minerName,
  open,
  onOpenChange,
}: {
  deploymentId: string;
  minerName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [busyRev, setBusyRev] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: ["revisions", deploymentId],
    queryFn: async () => {
      const res = await fetch(`/api/deployments/${deploymentId}/revisions`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      return (j.revisions ?? []) as RevisionDTO[];
    },
    enabled: open,
  });

  const rollback = async (rev: number) => {
    setBusyRev(rev);
    setMsg(null);
    try {
      const res = await fetch(`/api/deployments/${deploymentId}/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rev }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setMsg(`✓ ${j.rollback?.note ?? `Rolled back to r${rev}`}`);
      await qc.invalidateQueries({ queryKey: ["deployments"] });
      await refetch();
    } catch (e) {
      setMsg(e instanceof Error ? `Rollback failed: ${e.message}` : "Rollback failed");
    } finally {
      setBusyRev(null);
    }
  };

  const revisions = data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-primary" />
            Config revisions — {minerName}
          </DialogTitle>
          <DialogDescription>
            Every config change snapshots the previous state before writing. Rolling back restores
            that config and pushes it to the GPU (apply_config via the daemon).
          </DialogDescription>
        </DialogHeader>

        {msg && (
          <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">{msg}</p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading revisions…
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-destructive">
            {(error as Error).message}
          </p>
        ) : revisions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No revisions yet — the chain starts at this deployment's first deploy.
          </p>
        ) : (
          <ScrollArea className="max-h-[50vh] pr-2">
            <div className="flex flex-col">
              {revisions.map((r, i) => (
                <div key={r.id}>
                  {i > 0 && <Separator className="my-2" />}
                  <div className="flex items-start justify-between gap-3 py-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono text-xs font-medium">r{r.rev}</span>
                        <Badge variant="outline" className={cnCause(r.cause)}>
                          {r.cause}
                        </Badge>
                        {r.isCurrent && (
                          <Badge variant="outline" className="border-success/40 text-[10px] text-success">
                            current
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(new Date(r.createdAt))} · {r.actor}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground" title={r.summary}>
                        <GitBranch className="mr-1 inline h-3 w-3" />
                        {r.summary}
                      </p>
                      {r.note && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80" title={r.note}>
                          {r.note}
                        </p>
                      )}
                    </div>
                    {!r.isCurrent && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5"
                        disabled={busyRev !== null}
                        onClick={() => rollback(r.rev)}
                      >
                        {busyRev === r.rev ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCw className="h-3.5 w-3.5" />
                        )}
                        {busyRev === r.rev ? "Rolling back…" : "Roll back"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {isRefetching && (
          <p className="text-center text-[10px] text-muted-foreground">refreshing…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function cnCause(cause: string): string {
  return CAUSE_CHIP[cause] ?? "text-muted-foreground";
}
