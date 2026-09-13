"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Radar,
  RefreshCw,
  CheckCircle2,
  XCircle,
  PlayCircle,
  ChevronDown,
  ChevronRight,
  Rocket,
  Thermometer,
  Network,
  Scale,
  Skull,
  ShieldAlert,
  ServerCog,
  HeartPulse,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useDevopsMonitor } from "@/lib/infranex/use-devops-monitor";
import { useTriggerActions, type TriggerEventDTO } from "@/lib/infranex/use-triggers";
import type { ViewKey } from "@/lib/infranex/types";
import { MinerOpsCard } from "@/components/cards/devops/miner-ops-card";

/**
 * DEVOPS-1 — the DevOps Engine view. One live cockpit for every running
 * miner: summary vitals, recommendations inbox (approval-gated trigger
 * events from the 90s monitor pass), the per-miner ops board with GPU
 * sparklines, and the change feed (recently resolved/acted events).
 */

const KIND_META: Record<
  string,
  { label: string; icon: typeof RefreshCw; chip: string }
> = {
  RE_SYNC: { label: "RE-SYNC", icon: RefreshCw, chip: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  SCALE: { label: "SCALE", icon: Scale, chip: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  KILL: { label: "KILL", icon: Skull, chip: "border-red-500/40 bg-red-500/10 text-red-300" },
  DEREG_RISK: { label: "DEREG-RISK", icon: ShieldAlert, chip: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  GPU_HEALTH: { label: "GPU HEALTH", icon: Thermometer, chip: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  SUBNET_DRIFT: { label: "SUBNET DRIFT", icon: Network, chip: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" },
};

export function DevopsView({ onNavigate }: { onNavigate: (v: ViewKey) => void }) {
  const { data, isLoading, refetch, isFetching } = useDevopsMonitor();
  const actions = useTriggerActions();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const miners = data?.miners ?? [];
  const open = data?.openEvents ?? [];
  const recent = data?.recentEvents ?? [];
  const summary = data?.summary;

  // DEVOPS-2 — drift events with an executable GPU action get the
  // "Apply to GPU" label; everything else keeps the generic Execute.
  const gpuActionOf = (ev: TriggerEventDTO): { action: string; label: string } | null => {
    if (ev.kind !== "SUBNET_DRIFT") return null;
    const a = typeof ev.evidence?.suggestedAction === "string" ? ev.evidence.suggestedAction : null;
    if (a === "resync_config") return { action: a, label: "Re-sync miner config on the GPU" };
    if (a === "restart") return { action: a, label: "Restart miner to re-sync metagraph" };
    return null;
  };

  const handle = async (fn: () => Promise<unknown>, id?: string) => {
    setBusyId(id ?? "__run");
    setNote(null);
    try {
      const res = (await fn()) as { action?: string; pass?: { created: number; resolved: number; devopsEvaluated?: number } };
      if (res?.pass) {
        setNote(
          `Pass complete — ${res.pass.devopsEvaluated ?? res.pass.created} miners evaluated, ${res.pass.created} new findings, ${res.pass.resolved} resolved.`
        );
      } else if (res?.action) {
        setNote(res.action);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryTile
          icon={<Radar className="h-4 w-4 text-primary" aria-hidden />}
          label="Miners monitored"
          value={summary ? String(summary.monitored) : "—"}
        />
        <SummaryTile
          icon={<HeartPulse className="h-4 w-4 text-success" aria-hidden />}
          label="Healthy"
          value={summary ? String(summary.healthy) : "—"}
        />
        <SummaryTile
          icon={<ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden />}
          label="Warning"
          value={summary ? String(summary.warning) : "—"}
        />
        <SummaryTile
          icon={<Skull className="h-4 w-4 text-destructive" aria-hidden />}
          label="Critical"
          value={summary ? String(summary.critical) : "—"}
        />
        <SummaryTile
          icon={<ServerCog className="h-4 w-4 text-sky-400" aria-hidden />}
          label="Daemons online"
          value={summary ? String(summary.daemonsOnline) : "—"}
        />
      </div>

      {/* Engine status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                data?.lastPass?.status === "completed" ? "bg-success pulse-dot" : "bg-amber-400"
              )}
              aria-hidden
            />
            <span className="text-foreground/90">Monitor engine</span>
            {data?.lastPass ? (
              <span className="mono tabular">
                last pass {formatRelativeTime(data.lastPass.at)} · {data.lastPass.status} ·{" "}
                {data.lastPass.durationMs}ms · {data.lastPass.evaluated} miners
              </span>
            ) : (
              <span>waiting for first pass (runs every 90s)</span>
            )}
          </span>
          {summary && (
            <span>
              <span className="mono tabular text-foreground/90">{summary.openRecommendations}</span>{" "}
              open recommendation{summary.openRecommendations === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={isFetching || busyId === "__run"}
          onClick={() => handle(() => actions.runPass())}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (isFetching || busyId === "__run") && "animate-spin")} aria-hidden />
          Run pass now
        </Button>
      </div>

      {note && (
        <p
          role="status"
          className="rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm text-foreground/90"
        >
          {note}
        </p>
      )}

      {/* Recommendations inbox */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" aria-hidden />
              Recommendations
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                approval-gated
              </Badge>
            </span>
            <span className="mono text-[10px] font-normal text-muted-foreground/60">
              detected by the 90s monitor pass
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {open.length === 0 && (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
              No open recommendations — the engine is watching and will surface changes here.
            </p>
          )}
          {open.map((ev) => {
            const meta = KIND_META[ev.kind] ?? KIND_META.RE_SYNC;
            const Icon = meta.icon;
            const isOpen = expanded === ev.id;
            const busy = busyId === ev.id;
            const gpuAction = gpuActionOf(ev);
            const applyPlan = Array.isArray(ev.evidence?.applyPlan) ? (ev.evidence.applyPlan as string[]) : [];
            return (
              <div
                key={ev.id}
                className={cn(
                  "rounded-xl border bg-background/40 p-3",
                  ev.severity === "critical"
                    ? "border-destructive/30"
                    : ev.severity === "warning"
                      ? "border-amber-500/25"
                      : "border-border/60"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("h-5 gap-1 px-1.5 text-[10px]", meta.chip)}>
                        <Icon className="h-3 w-3" aria-hidden />
                        {meta.label}
                      </Badge>
                      <p className="text-sm font-medium leading-tight">{ev.title}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{ev.detail}</p>
                    {gpuAction && (
                      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-300">
                        <ServerCog className="h-3 w-3" aria-hidden />
                        GPU action on approval: {gpuAction.label}
                      </p>
                    )}
                    <p className="mono mt-1 text-[10px] text-muted-foreground/60">
                      {formatRelativeTime(ev.createdAt)} · status {ev.status}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {ev.status === "open" && (
                      <Button
                        size="sm"
                        className="h-7 gap-1 px-2.5 text-xs"
                        disabled={busy}
                        onClick={() => handle(() => actions.approve(ev.id), ev.id)}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        Approve
                      </Button>
                    )}
                    {ev.status === "approved" && (
                      <Button
                        size="sm"
                        className={cn(
                          "h-7 gap-1 px-2.5 text-xs",
                          gpuAction && "border border-cyan-400/40 bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
                        )}
                        disabled={busy}
                        onClick={() => handle(() => actions.act(ev.id), ev.id)}
                      >
                        <PlayCircle className="h-3.5 w-3.5" aria-hidden />
                        {gpuAction ? "Apply to GPU" : "Execute"}
                      </Button>
                    )}
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                        onClick={() => setExpanded(isOpen ? null : ev.id)}
                      >
                        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        Detail
                      </Button>
                      {ev.status === "open" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
                          disabled={busy}
                          onClick={() => handle(() => actions.dismiss(ev.id), ev.id)}
                        >
                          <XCircle className="h-3 w-3" aria-hidden />
                          Dismiss
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                {isOpen && (
                  <div className="mt-3 space-y-2 border-t border-border/40 pt-2">
                    {applyPlan.length > 0 && (
                      <div>
                        <p className="text-eyebrow text-muted-foreground/70">What runs on the GPU when approved</p>
                        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-foreground/85">
                          {applyPlan.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    <div>
                      <p className="text-eyebrow text-muted-foreground/70">Runbook</p>
                      <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {ev.runbook.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ol>
                    </div>
                    <div>
                      <p className="text-eyebrow text-muted-foreground/70">Evidence</p>
                      <pre className="mono mt-1 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-[10px] leading-relaxed text-muted-foreground">
{JSON.stringify(ev.evidence, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Live ops board */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-display text-lg font-semibold">Live operations board</h2>
          <span className="mono text-[10px] text-muted-foreground/60">
            auto-refresh 20s · engine pass every 90s
          </span>
        </div>
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl border border-border/50 bg-card/40" />
            ))}
          </div>
        ) : miners.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-14 text-center">
            <Radar className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
            <p className="mt-3 text-sm font-medium">No running miners to monitor yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Once a GPU miner deployment reaches the running state it appears here automatically — GPU
              vitals, subnet drift detection and approval-gated recommendations included.
            </p>
            <Button className="mt-4 gap-1.5" onClick={() => onNavigate("deployments")}>
              <Rocket className="h-4 w-4" aria-hidden />
              Go to Deployments
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {miners.map((m) => (
              <MinerOpsCard key={m.deploymentId} miner={m} thresholds={data!.thresholds} />
            ))}
          </div>
        )}
      </div>

      {/* Change feed */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Change feed</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Resolved and executed events will appear here as the engine detects and clears conditions.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((ev) => {
                const meta = KIND_META[ev.kind] ?? KIND_META.RE_SYNC;
                const Icon = meta.icon;
                return (
                  <li
                    key={ev.id}
                    className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-background/30 px-3 py-1.5"
                  >
                    <Badge variant="outline" className={cn("h-5 shrink-0 gap-1 px-1.5 text-[10px]", meta.chip)}>
                      <Icon className="h-3 w-3" aria-hidden />
                      {meta.label}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{ev.title}</span>
                    <span className="mono shrink-0 text-[10px] text-muted-foreground/60">
                      {ev.status} · {formatRelativeTime(ev.resolvedAt ?? ev.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-3.5">
      <p className="flex items-center gap-1.5 text-eyebrow text-muted-foreground/70">
        {icon}
        {label}
      </p>
      <p className="text-display mt-1.5 text-2xl font-bold tabular">{value}</p>
    </div>
  );
}
