"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  Gauge,
  GitBranch,
  Plus,
  Trash2,
  Power,
  PlayCircle,
  Zap,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { DevopsMonitorPayload } from "@/lib/infranex/use-devops-monitor";

/**
 * TIER3 — Autopilot control panel (policy rules + recent auto-actions) and
 * the Benchmark harness summary. Rendered on the DevOps view between the
 * engine status bar and the strategy board.
 */

const RULE_KINDS = [
  "ANY",
  "RE_SYNC",
  "GPU_HEALTH",
  "PROBE_FAIL",
  "SERVICE_LATENCY",
  "QUERY_DROUGHT",
  "SUBNET_DRIFT",
  "UPSTREAM_DRIFT",
  "BENCH_REGRESS",
  "RUNWAY",
  "SCALE",
  "ARBITRAGE",
  "RUNTIME_OPT",
] as const;

const SEVERITIES = ["info", "warning", "critical"] as const;

export function AutopilotPanel({ data }: { data: DevopsMonitorPayload }) {
  const rules = data.autopilot?.rules ?? [];
  const recent = data.autopilot?.recentActions ?? [];
  const benches = data.benchmarks ?? [];

  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("ANY");
  const [minSeverity, setMinSeverity] = useState<string>("warning");
  const [mockOnly, setMockOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const createRule = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/autopilot/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, minSeverity, mockOnly }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `create failed (${res.status})`);
      setName("");
      setNote(`Rule "${j.rule.name}" created — the engine evaluates it every 90s pass.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/autopilot/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `run failed (${res.status})`);
      const r = j.result as { openEvents: number; acted: { kind: string }[]; skipped: unknown[] };
      setNote(
        `Autopilot pass — ${r.openEvents} open events, ${r.acted.length} auto-executed${
          r.acted.length ? ` (${r.acted.map((a) => a.kind).join(", ")})` : ""
        }.`
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (id: string, enabled: boolean) => {
    setBusy(true);
    try {
      await fetch(`/api/autopilot/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } finally {
      setBusy(false);
    }
  };

  const deleteRule = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/autopilot/rules/${id}`, { method: "DELETE" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* Autopilot rules */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" aria-hidden />
              Autopilot
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                policy-gated
              </Badge>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
              disabled={busy}
              onClick={runNow}
            >
              <PlayCircle className="h-3.5 w-3.5" aria-hidden />
              Run now
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Matching open events are auto-approved and executed through the same audit path as human
            approvals. KILL, ESCALATION and recycle suggestions are always human-only; by default
            rules fire on mock deployments only.
          </p>

          {rules.length > 0 && (
            <ul className="space-y-1.5">
              {rules.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/30 px-2.5 py-1.5"
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 shrink-0 px-1.5 text-[10px]",
                      r.enabled
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : "border-border/60 bg-muted/30 text-muted-foreground"
                    )}
                  >
                    {r.enabled ? "active" : "off"}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{r.name}</span>
                  <span className="mono shrink-0 text-[10px] text-muted-foreground/70">
                    {r.kind} · ≥{r.minSeverity} · {r.mockOnly ? "mock" : "all"} · {r.maxPerHour}/h
                  </span>
                  <button
                    aria-label={r.enabled ? `Disable ${r.name}` : `Enable ${r.name}`}
                    className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                    disabled={busy}
                    onClick={() => toggleRule(r.id, !r.enabled)}
                  >
                    <Power className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    aria-label={`Delete ${r.name}`}
                    className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                    disabled={busy}
                    onClick={() => deleteRule(r.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Create rule */}
          <div className="space-y-2 rounded-lg border border-dashed border-border/50 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
              <Plus className="h-3 w-3" aria-hidden />
              New rule
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rule name — e.g. auto-restart probes"
                className="h-8 text-xs"
                maxLength={80}
              />
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Kind" />
                </SelectTrigger>
                <SelectContent>
                  {RULE_KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {k === "ANY" ? "ANY (all kinds)" : k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={minSeverity} onValueChange={setMinSeverity}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Min severity" />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      min severity: {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={mockOnly}
                  onChange={(e) => setMockOnly(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                mock deployments only
              </label>
            </div>
            <Button
              size="sm"
              className="h-7 gap-1 px-2.5 text-xs"
              disabled={busy || name.trim().length < 2}
              onClick={createRule}
            >
              <Zap className="h-3.5 w-3.5" aria-hidden />
              Add rule
            </Button>
          </div>

          {recent.length > 0 && (
            <div>
              <p className="text-eyebrow text-muted-foreground/70">Recent auto-actions</p>
              <ul className="mt-1 space-y-1">
                {recent.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Bot className="h-3 w-3 shrink-0 text-primary/70" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    <span className="mono shrink-0 text-[10px] text-muted-foreground/60">
                      {a.ruleName ? `${a.ruleName} · ` : ""}
                      {formatRelativeTime(a.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {note && <p className="text-[11px] text-foreground/85">{note}</p>}
        </CardContent>
      </Card>

      {/* Benchmarks */}
      <Card className="border-border/60 bg-card/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-primary" aria-hidden />
              Benchmarks
              <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
                axon latency
              </Badge>
            </span>
            <span className="mono text-[10px] font-normal text-muted-foreground/60">
              5 probes / run · every 10 min
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Each run times 5 synthetic validator queries against the axon and records p50/p95.
            A run slower than 1.5× the rolling baseline opens a regression event; recovery
            auto-resolves it. Mock fleets record simulated runs and never alarm.
          </p>
          {benches.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
              No benchmarks yet — the first run lands within 10 minutes of a miner starting.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {benches.map((b) => {
                const slower =
                  b.latest?.p50Ms != null &&
                  b.baselineP50Ms != null &&
                  b.latest.p50Ms > b.baselineP50Ms * 1.5;
                return (
                  <li
                    key={b.deploymentId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/40 bg-background/30 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {b.minerName}
                      {b.mode === "mock" && (
                        <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] text-muted-foreground">
                          sim
                        </Badge>
                      )}
                    </span>
                    {b.latest ? (
                      <span className="mono flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
                        <span className={cn("tabular", slower && "text-amber-300")}>
                          p50 {b.latest.p50Ms ?? "—"}ms
                        </span>
                        <span className="tabular">p95 {b.latest.p95Ms ?? "—"}ms</span>
                        <span className="tabular">{b.latest.successPct}%</span>
                        {b.baselineP50Ms != null && (
                          <span className="tabular text-muted-foreground/60">
                            base {b.baselineP50Ms}ms
                          </span>
                        )}
                        <GitBranch className="hidden h-3 w-3" aria-hidden />
                        <span className="text-muted-foreground/60">{b.runs} runs</span>
                      </span>
                    ) : (
                      <span className="mono shrink-0 text-[10px] text-muted-foreground/60">
                        no runs yet
                      </span>
                    )}
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
