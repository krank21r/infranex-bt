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
import { userMiners, deployments } from "@/lib/infranex/data";
import { cn, formatTao, formatCurrency, shortAddress, getStatusColor } from "@/lib/utils";
import type { ViewKey } from "@/lib/infranex/types";

interface MinersViewProps {
  onNavigate: (v: ViewKey) => void;
}

export function MinersView({ onNavigate }: MinersViewProps) {
  const totalEarnings = userMiners.reduce((a, m) => a + m.totalEarnings, 0);
  const dailyEmission = userMiners.reduce((a, m) => a + m.emission, 0);
  const active = userMiners.filter((m) => m.status === "active").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">Section · 05</p>
          <h1 className="text-display text-3xl font-bold tracking-tight md:text-4xl">
            My Miners
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your portfolio of Bittensor miners and live deployments.
          </p>
        </div>
        <Button className="gap-2 self-start sm:self-end">
          <Plus className="h-4 w-4" />
          Register miner
        </Button>
      </header>

      {/* Portfolio summary */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Card className="metric-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">
              Total earnings
            </p>
            <p className="tabular mt-1 text-2xl font-bold">
              {formatCurrency(totalEarnings * 412)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatTao(totalEarnings)} lifetime
            </p>
          </CardContent>
        </Card>
        <Card className="metric-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">
              Daily emission
            </p>
            <p className="tabular mt-1 text-2xl font-bold text-primary">
              {dailyEmission.toFixed(4)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              TAO / day · ≈ {formatCurrency(dailyEmission * 412)}/day
            </p>
          </CardContent>
        </Card>
        <Card className="metric-card">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground">
              Active miners
            </p>
            <p className="tabular mt-1 text-2xl font-bold">
              {active}
              <span className="text-base font-normal text-muted-foreground">
                /{userMiners.length}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              across {new Set(userMiners.map((m) => m.netuid)).size} subnets
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Miners list */}
      <Card className="border-border/60 bg-card/40">
        <CardHeader>
          <CardTitle className="text-display flex items-center gap-2 text-xl">
            <Coins className="h-4 w-4 text-primary" />
            Registered miners
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {userMiners.map((m) => {
            const status = getStatusColor(m.status);
            return (
              <div
                key={m.id}
                className="flex flex-col gap-4 rounded-lg border border-border/40 bg-card/30 p-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={cn(
                      "h-2.5 w-2.5 shrink-0 rounded-full",
                      status.dot
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{m.name}</p>
                      <Badge variant="outline" className="text-[10px]">
                        α{m.netuid}
                      </Badge>
                    </div>
                    <p className="mono text-xs text-muted-foreground">
                      {shortAddress(m.hotkey, 8, 6)}
                    </p>
                  </div>
                </div>

                <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Subnet</p>
                    <p className="truncate font-medium">{m.subnetName}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Rank</p>
                    <p className="tabular font-medium">
                      {m.rank > 0 ? `#${m.rank}` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Earnings</p>
                    <p className="tabular font-medium text-success">
                      {m.totalEarnings.toFixed(2)} TAO
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Uptime</p>
                    <p className="tabular font-medium">{m.uptimePercent.toFixed(1)}%</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                  <span className={cn("badge-status capitalize", status.bg, status.text)}>
                    {m.status}
                  </span>
                  <p className="text-[10px] text-muted-foreground">{m.gpu}</p>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Deployments */}
      <Card className="border-border/60 bg-card/40">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-display flex items-center gap-2 text-xl">
            <Server className="h-4 w-4 text-primary" />
            Deployments
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => onNavigate("gpus")}>
            New deployment
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {deployments.map((d) => (
            <div
              key={d.id}
              className="rounded-lg border border-border/40 bg-card/30 p-4"
            >
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
                        d.status === "started"
                          ? "bg-success/10 text-success"
                          : d.status === "failed"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-primary/10 text-primary"
                      )}
                    >
                      {d.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {d.subnetName} · {d.gpu} · {d.provider} · started{" "}
                    {d.startedAt}
                  </p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Cost/mo</p>
                    <p className="tabular font-medium">
                      {formatCurrency(d.estimatedMonthlyCost)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Rev/mo</p>
                    <p className="tabular font-medium text-success">
                      {formatCurrency(d.estimatedMonthlyRevenue)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Progress</span>
                  <span className="tabular">{d.progress}%</span>
                </div>
                <Progress
                  value={d.progress}
                  className="mt-1 h-1"
                  indicatorClassName={
                    d.status === "started"
                      ? "bg-success"
                      : d.status === "failed"
                        ? "bg-destructive"
                        : "bg-primary"
                  }
                />
              </div>

              <Separator className="my-3" />

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {d.steps.map((step) => {
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
          ))}
        </CardContent>
      </Card>

      <Card className="border-dashed border-border/60 bg-card/20">
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <Activity className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Monitoring engine collects GPU utilisation, temperature, and on-chain
            incentive every 60s for each running miner.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
