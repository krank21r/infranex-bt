"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Wand2,
  CheckCircle2,
  Settings2,
  ArrowRightLeft,
  Eye,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ArrowRight,
  Cpu,
  Network,
  Lightbulb,
  AlertTriangle,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useMonitoring } from "@/lib/infranex/use-monitoring";
import type { DeploymentRecommendation, RecommendationType } from "@/lib/infranex/optimization";
import type { ViewKey } from "@/lib/infranex/types";

interface OptimizationViewProps {
  onNavigate: (v: ViewKey) => void;
}

const TYPE_META: Record<
  RecommendationType,
  { label: string; icon: typeof CheckCircle2; color: string; bg: string; border: string }
> = {
  keep: { label: "Keep", icon: CheckCircle2, color: "text-success", bg: "bg-success/10", border: "border-success/30" },
  optimize: { label: "Optimize", icon: Settings2, color: "text-primary", bg: "bg-primary/10", border: "border-primary/30" },
  switch: { label: "Switch", icon: ArrowRightLeft, color: "text-warning", bg: "bg-warning/10", border: "border-warning/30" },
  watch: { label: "Watch", icon: Eye, color: "text-muted-foreground", bg: "bg-muted/50", border: "border-muted-foreground/30" },
};

export function OptimizationView({ onNavigate }: OptimizationViewProps) {
  const { data, isLoading, isFetching, refetch } = useMonitoring();

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Header onNavigate={onNavigate} />
        <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
          <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">Analyzing deployments…</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  const opts = data.optimizations;
  const recs = opts.recommendations;

  return (
    <div className="space-y-6">
      <Header onNavigate={onNavigate} onRefresh={() => refetch()} isFetching={isFetching} />

      {/* Portfolio summary */}
      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        <SummaryCard label="Total" value={opts.portfolio.totalDeployments} icon={<Wand2 className="h-4 w-4" />} tone="neutral" />
        <SummaryCard label="Keep" value={opts.portfolio.keep} icon={<CheckCircle2 className="h-4 w-4" />} tone="success" />
        <SummaryCard label="Optimize" value={opts.portfolio.optimize} icon={<Settings2 className="h-4 w-4" />} tone="primary" />
        <SummaryCard label="Switch" value={opts.portfolio.switch} icon={<ArrowRightLeft className="h-4 w-4" />} tone="warning" />
        <SummaryCard
          label="Projected Gain/mo"
          value={opts.portfolio.projectedMonthlyGainUsd !== 0 ? formatCurrency(opts.portfolio.projectedMonthlyGainUsd) : "—"}
          icon={opts.portfolio.projectedMonthlyGainUsd >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          tone={opts.portfolio.projectedMonthlyGainUsd >= 0 ? "success" : "destructive"}
        />
      </section>

      {/* Best/worst performers */}
      {(opts.portfolio.bestPerformer || opts.portfolio.worstPerformer) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {opts.portfolio.bestPerformer && (
            <Card className="border-success/30 bg-success/[0.04]">
              <CardContent className="flex items-center gap-3 py-3">
                <TrendingUp className="h-5 w-5 text-success" />
                <div>
                  <p className="text-xs text-muted-foreground">Best performer</p>
                  <p className="text-sm font-medium">{opts.portfolio.bestPerformer}</p>
                </div>
              </CardContent>
            </Card>
          )}
          {opts.portfolio.worstPerformer && (
            <Card className="border-destructive/30 bg-destructive/[0.04]">
              <CardContent className="flex items-center gap-3 py-3">
                <TrendingDown className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-xs text-muted-foreground">Needs attention</p>
                  <p className="text-sm font-medium">{opts.portfolio.worstPerformer}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Recommendations */}
      {recs.length === 0 ? (
        <Card className="border-dashed border-border/60 bg-card/20">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Wand2 className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-display text-lg font-medium">No active deployments to optimize</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Start a deployment and the optimization engine will analyze it and recommend Keep / Optimize / Switch actions.
              </p>
            </div>
            <Button className="mt-2 gap-2" onClick={() => onNavigate("deployments")}>
              <ArrowRight className="h-4 w-4" />
              Go to Deployments
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {recs
            .sort((a, b) => a.score - b.score) // worst first
            .map((rec) => (
              <RecommendationCard key={rec.deploymentId} rec={rec} onNavigate={onNavigate} />
            ))}
        </div>
      )}
    </div>
  );
}

function Header({
  onNavigate,
  onRefresh,
  isFetching,
}: {
  onNavigate: (v: ViewKey) => void;
  onRefresh?: () => void;
  isFetching?: boolean;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-eyebrow text-muted-foreground">Section · 08 · Optimization Engine</p>
        <h1 className="animate-rise text-display text-3xl font-bold tracking-tight md:text-4xl">
          Optimization
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Automated Keep / Optimize / Switch recommendations based on live monitoring data.
          Projected monthly gains from acting on each recommendation.
        </p>
      </div>
      <div className="flex gap-2">
        {onRefresh && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onRefresh} disabled={isFetching}>
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            {isFetching ? "Analyzing…" : "Re-analyze"}
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-2" onClick={() => onNavigate("monitoring")}>
          <Wand2 className="h-3.5 w-3.5" />
          Monitoring
        </Button>
      </div>
    </header>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone: "success" | "primary" | "warning" | "destructive" | "neutral";
}) {
  const toneClass = {
    success: "text-success",
    primary: "text-primary",
    warning: "text-warning",
    destructive: "text-destructive",
    neutral: "text-foreground",
  }[tone];
  return (
    <Card className="metric-card">
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <span className={toneClass}>{icon}</span>
        </div>
        <p className={cn("mt-1 tabular text-2xl font-bold", toneClass)}>{value}</p>
      </CardContent>
    </Card>
  );
}

function RecommendationCard({
  rec,
  onNavigate,
}: {
  rec: DeploymentRecommendation;
  onNavigate: (v: ViewKey) => void;
}) {
  const meta = TYPE_META[rec.type];
  const Icon = meta.icon;

  return (
    <Card className={cn("border bg-card/40", meta.border)}>
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg border", meta.bg, meta.border, meta.color)}>
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{rec.minerName}</p>
                <Badge variant="outline" className="mono text-[10px]">α{rec.netuid}</Badge>
                <Badge variant="outline" className="text-[10px]">{rec.subnetName}</Badge>
                <span className={cn("badge-status", meta.bg, meta.color)}>{meta.label}</span>
              </div>
              <p className="mt-1 text-sm font-medium">{rec.headline}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Health score</p>
            <p className={cn("tabular text-2xl font-bold", meta.color)}>{rec.score}</p>
            <p className="text-[10px] text-muted-foreground">/ 100</p>
          </div>
        </div>

        {/* Health score bar */}
        <div className="mt-3">
          <Progress
            value={rec.score}
            className="h-1.5"
            indicatorClassName={
              rec.score >= 70 ? "bg-success" : rec.score >= 40 ? "bg-primary" : rec.score >= 20 ? "bg-warning" : "bg-destructive"
            }
          />
        </div>

        {/* Reasoning */}
        {rec.reasoning.length > 0 && (
          <div className="mt-4">
            <p className="text-eyebrow text-muted-foreground mb-2">Analysis</p>
            <ul className="space-y-1">
              {rec.reasoning.map((r, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="mono shrink-0 text-primary">›</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4">
          <p className="text-eyebrow text-muted-foreground mb-2">Recommended actions</p>
          <div className="space-y-2">
            {rec.actions.map((action, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-2.5",
                  action.priority === "high" && "border-destructive/30 bg-destructive/[0.04]",
                  action.priority === "medium" && "border-warning/30 bg-warning/[0.04]",
                  action.priority === "low" && "border-border/40 bg-background/60"
                )}
              >
                <Lightbulb
                  className={cn(
                    "mt-0.5 h-3.5 w-3.5 shrink-0",
                    action.priority === "high" && "text-destructive",
                    action.priority === "medium" && "text-warning",
                    action.priority === "low" && "text-muted-foreground"
                  )}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium">{action.label}</p>
                    <Badge variant="outline" className={cn(
                      "text-[9px] capitalize",
                      action.priority === "high" && "border-destructive/30 text-destructive",
                      action.priority === "medium" && "border-warning/30 text-warning"
                    )}>
                      {action.priority}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{action.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alternatives (for switch/optimize) */}
        {(rec.alternatives.subnets.length > 0 || rec.alternatives.gpus.length > 0) && (
          <>
            <Separator className="my-4" />
            <div className="grid gap-4 sm:grid-cols-2">
              {rec.alternatives.subnets.length > 0 && (
                <div>
                  <p className="text-eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Network className="h-3 w-3" /> Alternative subnets
                  </p>
                  <div className="space-y-1.5">
                    {rec.alternatives.subnets.map((alt) => (
                      <div key={alt.netuid} className="rounded-lg border border-border/40 bg-background/60 p-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{alt.name}</span>
                            <Badge variant="outline" className="mono text-[10px]">{alt.symbol}</Badge>
                          </div>
                          <Badge variant="outline" className="text-[10px] text-success">{alt.score.toFixed(1)}</Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{alt.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {rec.alternatives.gpus.length > 0 && (
                <div>
                  <p className="text-eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Cpu className="h-3 w-3" /> Cheaper GPUs
                  </p>
                  <div className="space-y-1.5">
                    {rec.alternatives.gpus.map((alt, i) => (
                      <div key={i} className="rounded-lg border border-border/40 bg-background/60 p-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{alt.model}</span>
                            <Badge variant="outline" className="text-[10px]">{alt.provider}</Badge>
                          </div>
                          <Badge variant="outline" className="text-[10px] text-success">
                            -${alt.savingsPerMonth}/mo
                          </Badge>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">{alt.reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Projected improvement */}
        {rec.projectedImprovement.projectedRoi !== null && (
          <>
            <Separator className="my-4" />
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
              <div>
                <p className="text-eyebrow text-primary">Projected improvement</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  ROI: {rec.projectedImprovement.currentRoi !== null ? `${rec.projectedImprovement.currentRoi}%` : "—"} →{" "}
                  <span className="font-medium text-success">{rec.projectedImprovement.projectedRoi}%</span>
                </p>
              </div>
              {rec.projectedImprovement.monthlyGainUsd !== null && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Monthly gain</p>
                  <p className="tabular text-lg font-bold text-success">
                    +{formatCurrency(rec.projectedImprovement.monthlyGainUsd)}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Action buttons */}
        <div className="mt-4 flex items-center gap-2">
          {rec.type === "switch" && (
            <Button size="sm" className="gap-1.5" onClick={() => onNavigate("deployments")}>
              <ArrowRightLeft className="h-3.5 w-3.5" />
              Switch deployment
            </Button>
          )}
          {rec.type === "optimize" && (
            <Button size="sm" className="gap-1.5" onClick={() => onNavigate("deployments")}>
              <Settings2 className="h-3.5 w-3.5" />
              Apply optimization
            </Button>
          )}
          {rec.type === "keep" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onNavigate("monitoring")}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              View monitoring
            </Button>
          )}
          {rec.type === "watch" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onNavigate("monitoring")}>
              <Eye className="h-3.5 w-3.5" />
              Continue watching
            </Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
