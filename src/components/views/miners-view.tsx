"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Coins,
  Plus,
  Activity,
  Server,
  CheckCircle2,
  Loader2,
  Circle,
  XCircle,
} from "lucide-react";
import {
  useDeployments,
  type DeploymentRecord,
} from "@/lib/infranex/use-deployments";
import { cn, formatCurrency, formatRelativeTime, shortAddress } from "@/lib/utils";
import type { ViewKey } from "@/lib/infranex/types";

interface MinersViewProps {
  onNavigate: (v: ViewKey) => void;
}

// MOCK-PURGE-2 — this view previously rendered a fabricated portfolio
// (invented miners, earnings, uptime). It now reads REAL deployments from
// the platform database; with no miners deployed it is honestly empty.
function statusStyle(status: string): { dot: string; badge: string } {
  if (status === "started") {
    return { dot: "bg-success", badge: "bg-success/10 text-success" };
  }
  if (status === "failed" || status === "terminated") {
    return { dot: "bg-destructive", badge: "bg-destructive/10 text-destructive" };
  }
  if (status === "stopped") {
    return { dot: "bg-muted-foreground", badge: "bg-muted text-muted-foreground" };
  }
  return { dot: "bg-primary", badge: "bg-primary/10 text-primary" };
}

function DeploymentCard({ d }: { d: DeploymentRecord }) {
  const style = statusStyle(d.status);
  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-medium">{d.minerName}</p>
            <Badge variant="outline" className="mono text-[10px]">
              α{d.netuid}
            </Badge>
            <span
              className={cn(
                "badge-status capitalize",
                style.badge
              )}
            >
              {d.status}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.subnetName} · {d.gpuModel} · {d.provider} ·{" "}
            {d.hotkey ? shortAddress(d.hotkey, 8, 6) : "hotkey pending"} ·
            created {formatRelativeTime(d.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Cost/mo</p>
            <p className="tabular font-medium">
              {formatCurrency(d.monthlyCost)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Est. rev/mo</p>
            <p className="tabular font-medium text-success">
              {formatCurrency(d.estimatedRevenue)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Progress</span>
          <span className="tabular">{Math.round(d.progress)}%</span>
        </div>
        <Progress
          value={d.progress}
          className="mt-1 h-1"
          indicatorClassName={
            d.status === "started"
              ? "bg-success"
              : d.status === "failed" || d.status === "terminated"
                ? "bg-destructive"
                : "bg-primary"
          }
        />
      </div>

      <Separator className="my-3" />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {(d.steps ?? []).map((step) => {
          const Icon =
            step.status === "done"
              ? CheckCircle2
              : step.status === "running"
                ? Loader2
                : step.status === "failed"
                  ? XCircle
                  : Circle;
          return (
            <div
              key={step.name}
              className="flex items-center gap-1.5 text-xs"
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5",
                  step.status === "done"
                    ? "text-success"
                    : step.status === "running"
                      ? "animate-spin text-primary"
                      : step.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground/40"
                )}
              />
              <span
                className={cn(
                  step.status === "pending"
                    ? "text-muted-foreground/60"
                    : "text-foreground/80"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MinersView({ onNavigate }: MinersViewProps) {
  const { data: deployments, isLoading } = useDeployments();
  const rows = deployments ?? [];

  const active = rows.filter(
    (d) => d.status !== "terminated" && d.status !== "failed"
  );
  const running = rows.filter((d) => d.status === "started").length;
  const infraMonthly = active.reduce((a, d) => a + d.monthlyCost, 0);
  const revenueMonthly = active.reduce((a, d) => a + d.estimatedRevenue, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">Section · 08</p>
          <h1 className="animate-rise text-display text-3xl font-bold tracking-tight md:text-4xl">
            My Miners
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your portfolio of Bittensor miners and live deployments.
          </p>
        </div>
        <Button
          className="gap-2 self-start sm:self-end"
          onClick={() => onNavigate("gpus")}
        >
          <Plus className="h-4 w-4" />
          Register miner
        </Button>
      </header>

      {/* Portfolio summary — computed from REAL deployments only */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Card className="metric-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">
              Running miners
            </p>
            <p className="tabular mt-1 text-2xl font-bold">
              {running}
              <span className="text-base font-normal text-muted-foreground">
                /{rows.length}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {active.length} active pipeline{active.length === 1 ? "" : "s"} ·
              across {new Set(rows.map((d) => d.netuid)).size} subnet
              {new Set(rows.map((d) => d.netuid)).size === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>
        <Card className="metric-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">
              Infra cost
            </p>
            <p className="tabular mt-1 text-2xl font-bold text-primary">
              {formatCurrency(infraMonthly)}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                /mo
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              from live provider rentals
            </p>
          </CardContent>
        </Card>
        <Card className="metric-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">
              Est. revenue
            </p>
            <p className="tabular mt-1 text-2xl font-bold">
              {formatCurrency(revenueMonthly)}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                /mo
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              model estimate — realized earnings appear once a daemon reports
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Miners list — real deployments */}
      <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="text-display flex items-center gap-2 text-xl">
            <Coins className="h-4 w-4 text-primary" />
            Registered miners
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading deployments…
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Coins className="h-8 w-8 text-muted-foreground/50" />
              <div>
                <p className="font-medium">No miners yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Your fleet is honestly empty — nothing is deployed or
                  registered right now. Pick a GPU from the live catalog and
                  run the guided deploy wizard to register your first miner.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" className="gap-2" onClick={() => onNavigate("gpus")}>
                  <Plus className="h-3.5 w-3.5" />
                  Browse GPU catalog
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onNavigate("deployments")}
                >
                  Open deployments
                </Button>
              </div>
            </div>
          ) : (
            rows.map((d) => <DeploymentCard key={d.id} d={d} />)
          )}
        </CardContent>
      </Card>

      {/* Deployments pointer */}
      <Card className="border-dashed border-border/60 bg-card/20">
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <Activity className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Full lifecycle control (provision, install, register, migrate,
            terminate) lives in{" "}
            <button
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => onNavigate("deployments")}
            >
              <Server className="h-3.5 w-3.5" />
              Deployments
            </button>
            . The monitoring engine samples GPU utilisation, temperature, and
            on-chain incentive on every pass for each running miner with a
            connected daemon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
