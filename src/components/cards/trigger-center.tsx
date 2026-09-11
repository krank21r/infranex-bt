"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldAlert,
  RefreshCw,
  Scale,
  Zap,
  Skull,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import {
  useTriggers,
  useTriggerActions,
  type TriggerEventDTO,
} from "@/lib/infranex/use-triggers";
import type { ViewKey } from "@/lib/infranex/types";

const KIND_META = {
  RE_SYNC: { label: "RE-SYNC", icon: RefreshCw, chip: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  SCALE: { label: "SCALE", icon: Scale, chip: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  KILL: { label: "KILL", icon: Skull, chip: "border-red-500/40 bg-red-500/10 text-red-300" },
  DEREG_RISK: { label: "DEREG-RISK", icon: ShieldAlert, chip: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
} as const;

export function TriggerCenter({ onNavigate }: { onNavigate: (v: ViewKey) => void }) {
  const { data, isLoading, refetch, isFetching } = useTriggers();
  const actions = useTriggerActions();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const open = data?.open ?? [];

  const handle = async (fn: () => Promise<unknown>, id?: string) => {
    setBusyId(id ?? "__run");
    setNote(null);
    try {
      const res = (await fn()) as { action?: string; pass?: { created: number; resolved: number; deploymentsEvaluated: number } };
      if (res?.pass) {
        setNote(
          `Pass complete — ${res.pass.deploymentsEvaluated} deployments evaluated, ${res.pass.created} new, ${res.pass.resolved} resolved.`
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
    <Card className="border-border/60 bg-card/40">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Trigger Center
            <span className="text-xs font-normal text-muted-foreground">
              every action needs your approval
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => handle(() => actions.runPass())}
              disabled={busyId === "__run"}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", busyId === "__run" && "animate-spin")} />
              Run evaluation
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {note && (
          <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary/90">
            {note}
          </p>
        )}

        {/* Kind chips */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(KIND_META) as (keyof typeof KIND_META)[]).map((kind) => {
            const meta = KIND_META[kind];
            const Icon = meta.icon;
            const count = open.filter((e) => e.kind === kind).length;
            return (
              <div
                key={kind}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2.5",
                  meta.chip,
                  count === 0 && "opacity-45"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="mono text-[10px] font-semibold tracking-wide">{meta.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {count === 0 ? "no alerts" : `${count} open`}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Open events */}
        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading triggers…</p>
        ) : open.length === 0 ? (
          <p className="rounded-xl border border-border/40 bg-background/30 py-6 text-center text-sm text-muted-foreground">
            No open triggers — deployments look healthy.
          </p>
        ) : (
          <div className="space-y-2">
            {open.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                expanded={expanded === e.id}
                busy={busyId === e.id}
                onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                onApprove={async () => {
                  await handle(() => actions.approve(e.id), e.id);
                  await handle(() => actions.act(e.id), e.id);
                }}
                onDismiss={() => handle(() => actions.dismiss(e.id), e.id)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventRow({
  event,
  expanded,
  busy,
  onToggle,
  onApprove,
  onDismiss,
  onNavigate,
}: {
  event: TriggerEventDTO;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onApprove: () => Promise<void>;
  onDismiss: () => void;
  onNavigate: (v: ViewKey) => void;
}) {
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border border-border/50 bg-background/30">
      <button
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", meta.chip)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{event.title}</p>
          <p className="text-xs text-muted-foreground">
            {event.kind} · {formatRelativeTime(event.createdAt)}
            {event.netuid !== null ? ` · α${event.netuid}` : ""}
          </p>
        </div>
        {event.status === "approved" ? (
          <Badge variant="outline" className="shrink-0 border-lime-500/40 text-lime-300">
            executing…
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={cn(
              "shrink-0",
              event.severity === "critical"
                ? "border-red-500/40 text-red-300"
                : event.severity === "warning"
                  ? "border-amber-500/40 text-amber-300"
                  : "border-sky-500/40 text-sky-300"
            )}
          >
            {event.severity}
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border/40 px-3.5 py-3">
          <p className="text-xs text-muted-foreground">{event.detail}</p>

          {event.runbook.length > 0 && (
            <div>
              <p className="text-eyebrow mb-1 text-muted-foreground">Runbook</p>
              <ol className="list-inside list-decimal space-y-0.5 text-xs text-foreground/80">
                {event.runbook.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </div>
          )}

          {Object.keys(event.evidence).length > 0 && (
            <div>
              <p className="text-eyebrow mb-1 text-muted-foreground">Evidence</p>
              <pre className="max-h-40 overflow-auto rounded-lg border border-border/40 bg-background/50 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground custom-scroll">
                {JSON.stringify(event.evidence, null, 2)}
              </pre>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {event.status === "open" && (
              <>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={() => void onApprove()}
                >
                  {busy ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {event.kind === "DEREG_RISK" ? "Approve & defend" : "Approve & execute"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={onDismiss}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Dismiss
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => onNavigate("optimization")}
            >
              <Zap className="h-3.5 w-3.5" />
              Optimization Engine
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
