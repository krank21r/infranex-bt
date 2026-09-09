"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  Server,
  Coins,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Cpu,
  Wifi,
  Clock,
  DollarSign,
  Gauge,
  Zap,
  RefreshCw,
} from "lucide-react";
import { cn, formatCurrency, formatNumber, formatRelativeTime, formatDuration } from "@/lib/utils";
import { useMonitoring, type MonitoringOverview } from "@/lib/infranex/use-monitoring";
import type { MonitoredDeployment } from "@/lib/infranex/monitoring";
import type { ViewKey } from "@/lib/infranex/types";

interface MonitoringViewProps {
  onNavigate: (v: ViewKey) => void;
}

export function MonitoringView({ onNavigate }: MonitoringViewProps) {
  const { data: overview, isLoading, isFetching, refetch } = useMonitoring();

  if (isLoading || !overview) {
    return (
      <div className="space-y-6">
        <Header onNavigate={onNavigate} />
        <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
          <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading live monitoring data…</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const active = overview.deployments.filter(
    (d) => d.status !== "terminated" && d.status !== "failed"
  );
  const terminal = overview.deployments.filter(
    (d) => d.status === "terminated" || d.status === "failed"
  );

  return (
    <div className="space-y-6">
      <Header onNavigate={onNavigate} onRefresh={() => refetch()} isFetching={isFetching} />

      {/* Overview metrics */}
      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Started Miners"
          value={overview.totalStarted}
          icon={<Activity className="h-4 w-4" />}
          subtitle={`of ${overview.totalActive} active`}
          tone={overview.totalStarted > 0 ? "success" : "neutral"}
        />
        <MetricCard
          title="Daily Emission"
          value={overview.taoPriceUsd > 0 ? formatCurrency(overview.totalEmissionPerDayUsd) : "—"}
          icon={<Coins className="h-4 w-4" />}
          subtitle={`TAO/USD $${overview.taoPriceUsd.toFixed(2)}`}
          tone="primary"
        />
        <MetricCard
          title="Monthly Cost"
          value={formatCurrency(overview.totalCostPerMonthUsd)}
          icon={<DollarSign className="h-4 w-4" />}
          subtitle="GPU rental"
          tone="destructive"
        />
        <MetricCard
          title="Net Profit/mo"
          value={overview.totalNetProfitPerMonthUsd !== 0 ? formatCurrency(overview.totalNetProfitPerMonthUsd) : "—"}
          icon={overview.totalNetProfitPerMonthUsd >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          subtitle={`ROI ${overview.totalCostPerMonthUsd > 0 ? Math.round((overview.totalNetProfitPerMonthUsd / overview.totalCostPerMonthUsd) * 100) : 0}%`}
          tone={overview.totalNetProfitPerMonthUsd >= 0 ? "success" : "destructive"}
        />
      </section>

      {/* Alerts summary */}
      {overview.totalAlerts > 0 && (
        <Card className={cn(
          "border",
          overview.criticalAlerts > 0 ? "border-destructive/40 bg-destructive/[0.04]" : "border-warning/40 bg-warning/[0.04]"
        )}>
          <CardContent className="flex items-center gap-4 py-4">
            <AlertTriangle className={cn("h-6 w-6", overview.criticalAlerts > 0 ? "text-destructive" : "text-warning")} />
            <div className="flex-1">
              <p className="text-sm font-medium">
                {overview.totalAlerts} alert{overview.totalAlerts !== 1 ? "s" : ""}
                {overview.criticalAlerts > 0 && (
                  <span className="ml-2 text-destructive">· {overview.criticalAlerts} critical</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                See individual deployments below for details
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active deployments */}
      {active.length > 0 && (
        <section className="space-y-3">
          <p className="text-eyebrow text-muted-foreground">
            Active deployments · {active.length}
          </p>
          <div className="grid gap-4">
            {active.map((dep) => (
              <DeploymentMonitoringCard key={dep.id} dep={dep} taoPriceUsd={overview.taoPriceUsd} />
            ))}
          </div>
        </section>
      )}

      {/* Terminal deployments */}
      {terminal.length > 0 && (
        <section className="space-y-3">
          <p className="text-eyebrow text-muted-foreground">
            Terminated · {terminal.length}
          </p>
          <div className="grid gap-4 opacity-60">
            {terminal.map((dep) => (
              <DeploymentMonitoringCard key={dep.id} dep={dep} taoPriceUsd={overview.taoPriceUsd} />
            ))}
          </div>
        </section>
      )}

      {overview.deployments.length === 0 && (
        <Card className="border-dashed border-border/60 bg-card/20">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Activity className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-display text-lg font-medium">No deployments to monitor</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create and start a deployment to see live monitoring data here.
              </p>
            </div>
            <Button className="mt-2 gap-2" onClick={() => onNavigate("deployments")}>
              <Zap className="h-4 w-4" />
              Go to Deployments
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Header({ onNavigate, onRefresh, isFetching }: { onNavigate: (v: ViewKey) => void; onRefresh?: () => void; isFetching?: boolean }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-eyebrow text-muted-foreground">
          Section · 07 · Monitoring Engine ·{" "}
          <span className="text-primary">Step 4 — watch it mine</span>
        </p>
        <h1 className="animate-rise text-display text-3xl font-bold tracking-tight md:text-4xl">
          Monitoring
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live GPU + miner + incentive monitoring for every started deployment.
          Rewards, cost, and ROI tracked in real time.
        </p>
      </div>
      <div className="flex gap-2">
        {onRefresh && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onRefresh} disabled={isFetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            {isFetching ? "Syncing…" : "Refresh"}
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-2" onClick={() => onNavigate("deployments")}>
          <Server className="h-3.5 w-3.5" />
          Deployments
        </Button>
      </div>
    </header>
  );
}

function MetricCard({
  title,
  value,
  icon,
  subtitle,
  tone,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  subtitle?: string;
  tone?: "success" | "primary" | "destructive" | "neutral";
}) {
  const toneClass = {
    success: "text-success",
    primary: "text-primary",
    destructive: "text-destructive",
    neutral: "text-foreground",
  }[tone ?? "neutral"];
  return (
    <Card className="metric-card">
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className={cn("tabular text-2xl font-bold", toneClass)}>{value}</p>
              {icon && <span className="text-muted-foreground">{icon}</span>}
            </div>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DeploymentMonitoringCard({
  dep,
  taoPriceUsd,
}: {
  dep: MonitoredDeployment;
  taoPriceUsd: number;
}) {
  const { monitoring: m, status, mode } = dep;
  const isStarted = status === "started";
  const isTerminal = status === "terminated" || status === "failed";
  const hasPod = m.pod.exists;
  const podRunning = m.pod.desiredStatus === "RUNNING";

  const statusColor = isStarted
    ? "bg-success/10 text-success"
    : isTerminal
      ? "bg-muted/50 text-muted-foreground"
      : "bg-primary/10 text-primary";

  return (
    <Card className={cn(
      "border-border/60 bg-card/40 backdrop-blur-sm",
      m.alerts.some((a) => a.level === "critical") && "border-destructive/40"
    )}>
      <CardContent className="p-5">
        {/* Header row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className={cn("pulse-dot mt-1.5", isStarted ? "text-success" : isTerminal ? "text-muted-foreground" : "text-primary")} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{dep.minerName}</p>
                <Badge variant="outline" className="mono text-[10px]">α{dep.netuid}</Badge>
                <Badge variant="outline" className="text-[10px]">{dep.subnetName}</Badge>
                <span className={cn("badge-status capitalize", statusColor)}>{status}</span>
                <Badge variant="outline" className={cn("text-[9px]", mode === "runpod" ? "border-primary/30 text-primary" : "text-muted-foreground")}>
                  {mode}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {dep.gpuModel} · {dep.provider}
                {m.pod.publicIp && <span className="mono"> · {m.pod.publicIp}</span>}
                {" · "}created {formatRelativeTime(new Date(dep.createdAt))}
              </p>
            </div>
          </div>
        </div>

        {/* Monitoring grid */}
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {/* GPU / Pod status */}
          <div className="rounded-lg border border-border/40 bg-background/60 p-3">
            <p className="text-eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
              <Cpu className="h-3 w-3" /> GPU / Pod
            </p>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pod status</span>
                {hasPod ? (
                  <span className={cn("badge-status", podRunning ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
                    {m.pod.desiredStatus ?? "unknown"}
                  </span>
                ) : mode === "mock" ? (
                  <span className="badge-status bg-muted/50 text-muted-foreground">simulated</span>
                ) : (
                  <span className="badge-status bg-destructive/10 text-destructive">not found</span>
                )}
              </div>
              <MonitorRow label="GPU count" value={m.pod.gpuCount != null ? String(m.pod.gpuCount) : "—"} mono />
              <MonitorRow label="Uptime" value={m.pod.uptimeSeconds ? formatDuration(m.pod.uptimeSeconds) : "—"} mono />
              <MonitorRow label="Cost/hr" value={m.pod.costPerHr != null ? `$${m.pod.costPerHr.toFixed(4)}` : "—"} mono />
              <MonitorRow label="Image" value={m.pod.imageUrl ? m.pod.imageUrl.split("/").pop() ?? m.pod.imageUrl : "—"} mono />
            </div>
          </div>

          {/* On-chain metrics */}
          <div className="rounded-lg border border-border/40 bg-background/60 p-3">
            <p className="text-eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
              <Wifi className="h-3 w-3" /> On-chain
            </p>
            <div className="space-y-1.5 text-xs">
              <MonitorRow label="Rank" value={m.chain.rank != null ? `#${m.chain.rank}` : "—"} mono />
              <MonitorRow
                label="Incentive"
                value={m.chain.incentive != null ? `${(m.chain.incentive * 100).toFixed(2)}%` : "—"}
                mono
                tone={m.chain.incentive != null && m.chain.incentive > 0.05 ? "success" : "neutral"}
              />
              <MonitorRow
                label="Trust"
                value={m.chain.trust != null ? `${(m.chain.trust * 100).toFixed(2)}%` : "—"}
                mono
              />
              <MonitorRow label="Consensus" value={m.chain.consensus != null ? `${(m.chain.consensus * 100).toFixed(2)}%` : "—"} mono />
              <MonitorRow label="On chain" value={m.chain.found ? "✓ registered" : "—"} tone={m.chain.found ? "success" : "neutral"} />
            </div>
          </div>

          {/* Rewards / ROI */}
          <div className="rounded-lg border border-border/40 bg-background/60 p-3">
            <p className="text-eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
              <DollarSign className="h-3 w-3" /> Rewards & ROI
            </p>
            <div className="space-y-1.5 text-xs">
              <MonitorRow label="Emission/day" value={m.rewards.emissionPerDayTao != null ? `${m.rewards.emissionPerDayTao.toFixed(4)} TAO` : "—"} mono />
              <MonitorRow label="Emission/day" value={m.rewards.emissionPerDayUsd != null ? formatCurrency(m.rewards.emissionPerDayUsd) : "—"} mono tone="success" />
              <MonitorRow label="Cost/mo" value={m.rewards.costPerMonthUsd != null ? formatCurrency(m.rewards.costPerMonthUsd) : "—"} mono tone="destructive" />
              <MonitorRow label="Profit/mo" value={m.rewards.netProfitPerMonthUsd != null ? formatCurrency(m.rewards.netProfitPerMonthUsd) : "—"} mono tone={m.rewards.netProfitPerMonthUsd != null && m.rewards.netProfitPerMonthUsd >= 0 ? "success" : "destructive"} />
              <MonitorRow
                label="ROI"
                value={m.rewards.roiPercent != null ? `${m.rewards.roiPercent >= 0 ? "+" : ""}${m.rewards.roiPercent}%` : "—"}
                mono
                tone={m.rewards.roiPercent != null && m.rewards.roiPercent >= 0 ? "success" : "destructive"}
              />
            </div>
          </div>
        </div>

        {/* Alerts */}
        {m.alerts.length > 0 && (
          <>
            <Separator className="my-3" />
            <div className="space-y-1.5">
              {m.alerts.map((alert, i) => (
                <div key={i} className={cn(
                  "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs",
                  alert.level === "critical" && "bg-destructive/[0.06] text-destructive",
                  alert.level === "warning" && "bg-warning/[0.06] text-warning",
                  alert.level === "info" && "bg-muted/30 text-muted-foreground"
                )}>
                  {alert.level === "critical" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : alert.level === "warning" ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <div>
                    <span className="mono text-[10px] uppercase tracking-wider opacity-70">{alert.code}</span>
                    <p>{alert.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MonitorRow({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "success" | "destructive" | "neutral";
}) {
  const toneClass = {
    success: "text-success",
    destructive: "text-destructive",
    neutral: "text-foreground",
  }[tone ?? "neutral"];
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", mono && "mono tabular", toneClass)}>{value}</span>
    </div>
  );
}
