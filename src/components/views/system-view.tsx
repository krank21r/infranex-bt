"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Trash2,
  Activity,
  Server,
  Wifi,
  Database,
  Cpu,
  ArrowRight,
  Terminal,
  Clock,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useNetwork } from "@/lib/infranex/use-network";
import { useHealthChecks } from "@/lib/infranex/use-health-checks";
import { useErrorLog } from "@/lib/infranex/use-error-log";
import type { ViewKey } from "@/lib/infranex/types";

interface SystemViewProps {
  onNavigate: (v: ViewKey) => void;
}

export function SystemView({ onNavigate }: SystemViewProps) {
  const { data: snap, isFetching, refetch } = useNetwork();
  const { checks, run: runChecks, running } = useHealthChecks();
  const { errors, clear } = useErrorLog();

  const allPass = checks.every((c) => c.status === "pass");
  const anyFail = checks.some((c) => c.status === "fail");
  const overallStatus = anyFail ? "degraded" : allPass ? "operational" : "checking";

  const chainCheck = checks.find((c) => c.id === "chain");
  const priceCheck = checks.find((c) => c.id === "price");
  const apiCheck = checks.find((c) => c.id === "api");
  const gpuCheck = checks.find((c) => c.id === "gpu");

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">Section · 07</p>
          <h1 className="text-display text-3xl font-bold tracking-tight md:text-4xl">
            System &amp; Errors
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live health checks for every dependency that keeps the app running —
            diagnose and resolve issues here.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 self-start sm:self-end"
          onClick={() => {
            runChecks();
            refetch();
          }}
          disabled={running || isFetching}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", (running || isFetching) && "animate-spin")} />
          {running || isFetching ? "Re-checking…" : "Re-run all checks"}
        </Button>
      </header>

      {/* Overall status */}
      <Card
        className={cn(
          "border-2",
          overallStatus === "operational" && "border-success/40 bg-success/[0.04]",
          overallStatus === "degraded" && "border-destructive/40 bg-destructive/[0.04]",
          overallStatus === "checking" && "border-primary/40 bg-primary/[0.04]"
        )}
      >
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-xl border",
                overallStatus === "operational" && "border-success/40 bg-success/10 text-success",
                overallStatus === "degraded" && "border-destructive/40 bg-destructive/10 text-destructive",
                overallStatus === "checking" && "border-primary/40 bg-primary/10 text-primary"
              )}
            >
              {overallStatus === "operational" ? (
                <CheckCircle2 className="h-6 w-6" />
              ) : overallStatus === "degraded" ? (
                <XCircle className="h-6 w-6" />
              ) : (
                <Activity className="h-6 w-6 animate-pulse" />
              )}
            </span>
            <div>
              <p className="text-eyebrow text-muted-foreground">Overall status</p>
              <p className="text-display text-2xl font-bold capitalize">
                {overallStatus === "operational"
                  ? "All systems operational"
                  : overallStatus === "degraded"
                    ? "Degraded — resolve below"
                    : "Checking dependencies…"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {overallStatus === "operational"
                  ? "Chain, price feed, and API are all reachable. The app is running live."
                  : overallStatus === "degraded"
                    ? `${checks.filter((c) => c.status === "fail").length} of ${checks.length} checks failing. See the resolution steps below.`
                    : "Probing each dependency — this takes a few seconds."}
              </p>
            </div>
          </div>
          {snap && (
            <div className="grid grid-cols-3 gap-4 text-center sm:flex sm:gap-6">
              <Metric label="Block" value={snap.blockNumber ? snap.blockNumber.toLocaleString() : "—"} live={snap.source === "live"} />
              <Metric label="TAO" value={snap.taoPriceUsd ? `$${snap.taoPriceUsd.toFixed(2)}` : "—"} live={snap.taoPriceUsd > 0} />
              <Metric label="Subnets" value={snap.totalSubnets ? String(snap.totalSubnets) : "—"} live={snap.totalSubnets > 0} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Health checks */}
      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <HealthCheckCard
          check={apiCheck}
          icon={<Server className="h-4 w-4" />}
          onRetry={refetch}
          isFetching={isFetching}
        />
        <HealthCheckCard
          check={chainCheck}
          icon={<Wifi className="h-4 w-4" />}
          onRetry={runChecks}
          isFetching={running}
        />
        <HealthCheckCard
          check={priceCheck}
          icon={<Database className="h-4 w-4" />}
          onRetry={runChecks}
          isFetching={running}
        />
        <HealthCheckCard
          check={gpuCheck}
          icon={<Cpu className="h-4 w-4" />}
          onRetry={runChecks}
          isFetching={running}
        />
      </section>

      {/* Resolution steps */}
      {anyFail && (
        <Card className="border-warning/30 bg-warning/[0.04]">
          <CardHeader>
            <p className="text-eyebrow text-warning">Resolution required</p>
            <CardTitle className="text-display flex items-center gap-2 text-xl">
              <AlertTriangle className="h-4 w-4 text-warning" />
              How to fix failing checks
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {checks
              .filter((c) => c.status === "fail")
              .map((c) => (
                <ResolutionSteps key={c.id} checkId={c.id} detail={c.detail} endpoint={c.endpoint} />
              ))}
          </CardContent>
        </Card>
      )}

      {/* Error log */}
      <Card className="border-border/60 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <p className="text-eyebrow text-muted-foreground">Client-side · this session</p>
            <CardTitle className="text-display flex items-center gap-2 text-xl">
              <Terminal className="h-4 w-4 text-primary" />
              Runtime error log
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="mono text-[10px]">
              {errors.length} captured
            </Badge>
            {errors.length > 0 && (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={clear}>
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {errors.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <p className="text-sm">No runtime errors captured this session.</p>
              <p className="text-xs">
                Uncaught exceptions and unhandled promise rejections will appear here in real time.
              </p>
            </div>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto custom-scroll">
              {errors.map((err) => (
                <div
                  key={err.id}
                  className="rounded-lg border border-destructive/30 bg-destructive/[0.04] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "mono text-[10px]",
                          err.type === "unhandledrejection"
                            ? "border-warning/40 text-warning"
                            : "border-destructive/40 text-destructive"
                        )}
                      >
                        {err.type === "unhandledrejection" ? "PROMISE" : "ERROR"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        <Clock className="mr-1 inline h-3 w-3" />
                        {formatRelativeTime(new Date(err.timestamp))}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 font-mono text-sm text-foreground">
                    {err.message}
                  </p>
                  {err.source && (
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {err.source}
                      {err.lineno ? `:${err.lineno}${err.colno ? `:${err.colno}` : ""}` : ""}
                    </p>
                  )}
                  {err.stack && (
                    <pre className="mt-2 max-h-32 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px] text-muted-foreground custom-scroll">
                      {err.stack}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick links */}
      <Card className="border-border/60 bg-card/40">
        <CardHeader>
          <p className="text-eyebrow text-muted-foreground">Quick actions</p>
          <CardTitle className="text-display text-xl">Jump to a view</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <QuickLink label="Dashboard" hint="Live metrics & charts" onClick={() => onNavigate("dashboard")} />
          <QuickLink label="Subnets" hint="16 tracked, live data" onClick={() => onNavigate("subnets")} />
          <QuickLink label="Opportunities" hint="Ranked by live score" onClick={() => onNavigate("opportunities")} />
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, live }: { label: string; value: string; live: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("mono tabular text-sm font-bold", live ? "text-success" : "text-muted-foreground")}>
        {value}
      </p>
    </div>
  );
}

function HealthCheckCard({
  check,
  icon,
  onRetry,
  isFetching,
}: {
  check?: { id: string; name: string; description: string; status: string; latencyMs: number | null; detail: string; lastChecked: number | null; endpoint: string };
  icon: React.ReactNode;
  onRetry: () => void;
  isFetching: boolean;
}) {
  if (!check) return null;
  const pass = check.status === "pass";
  const fail = check.status === "fail";
  return (
    <Card
      className={cn(
        "border-border/60 bg-card/40 transition-colors",
        pass && "border-success/30",
        fail && "border-destructive/30"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg border",
                pass && "border-success/40 bg-success/10 text-success",
                fail && "border-destructive/40 bg-destructive/10 text-destructive",
                !pass && !fail && "border-muted-foreground/30 bg-muted/30 text-muted-foreground"
              )}
            >
              {icon}
            </span>
            <div>
              <CardTitle className="text-display text-base">{check.name}</CardTitle>
              <p className="text-xs text-muted-foreground">{check.description}</p>
            </div>
          </div>
          {check.status === "pass" ? (
            <CheckCircle2 className="h-5 w-5 text-success" />
          ) : check.status === "fail" ? (
            <XCircle className="h-5 w-5 text-destructive" />
          ) : (
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Status</span>
          <Badge
            variant="outline"
            className={cn(
              "capitalize",
              pass && "border-success/40 text-success",
              fail && "border-destructive/40 text-destructive"
            )}
          >
            {check.status}
          </Badge>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Latency</span>
          <span className="mono tabular font-medium">
            {check.latencyMs !== null ? `${check.latencyMs}ms` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Last checked</span>
          <span className="tabular">
            {check.lastChecked ? formatRelativeTime(new Date(check.lastChecked)) : "—"}
          </span>
        </div>
        <Separator />
        <div>
          <p className="text-[10px] text-muted-foreground">Detail</p>
          <p
            className={cn(
              "mt-0.5 text-xs",
              fail ? "text-destructive" : "text-foreground/80"
            )}
          >
            {check.detail}
          </p>
        </div>
        <p className="truncate font-mono text-[10px] text-muted-foreground/70">
          {check.endpoint}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={onRetry}
          disabled={isFetching}
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          {isFetching ? "Retrying…" : "Retry check"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ResolutionSteps({
  checkId,
  detail,
  endpoint,
}: {
  checkId: string;
  detail: string;
  endpoint: string;
}) {
  const steps: Record<string, string[]> = {
    chain: [
      "The Bittensor Finney chain node may be temporarily unreachable or rate-limiting.",
      "Wait 30s — the next poll will retry automatically.",
      "If persistent, the public entrypoint node may be down. Check https://taostats.io or try again later.",
      "The app will keep showing the last cached snapshot until the chain recovers.",
    ],
    price: [
      "CoinGecko's free API rate-limits requests. If you've polled too frequently, wait 60s.",
      "CoinGecko may be blocking the request (needs a User-Agent header — already set).",
      "If down, the app still works with live chain data; only the TAO/USD conversion shows as '—'.",
      "For production, add a CoinGecko API key or switch to a paid price provider.",
    ],
    api: [
      "The local /api/network route failed — check the dev server logs at /home/z/my-project/dev.log.",
      "The chain read takes ~5s on a cold cache; if it timed out, the 30s cache will serve subsequent requests.",
      "Restart the dev server if the route is throwing: `bun run dev`.",
      "If the chain is down, /api/network returns source='error' — the UI falls back to curated values.",
    ],
    gpu: [
      "The RunPod GraphQL API may be rate-limiting or the API key may be invalid/expired.",
      "Check that RUNPOD_API_KEY is set in /home/z/my-project/.env (server-side only, no NEXT_PUBLIC_ prefix).",
      "The 60s cache will retry automatically on the next poll.",
      "If RunPod is down, the GPU catalog falls back to indicative static prices from other providers.",
    ],
  };
  const list = steps[checkId] ?? ["No specific steps — retry the check."];
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline" className="border-destructive/40 text-[10px] text-destructive">
          {checkId.toUpperCase()}
        </Badge>
        <span className="text-sm font-medium">Failing</span>
        <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">
          {endpoint}
        </span>
      </div>
      <p className="mb-3 font-mono text-xs text-destructive">{detail}</p>
      <ol className="space-y-1.5">
        {list.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm text-muted-foreground">
            <span className="mono shrink-0 text-primary">{i + 1}.</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function QuickLink({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex items-center justify-between rounded-lg border border-border/40 bg-card/30 p-4 text-left transition-all hover:border-primary/40 hover:bg-card/60"
    >
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}
