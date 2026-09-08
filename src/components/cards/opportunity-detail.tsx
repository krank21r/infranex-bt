"use client";

import { cn, formatCurrency, formatPercent, getStatusColor, scoreBand } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { TrendingUp, AlertTriangle, Cpu, Wallet } from "lucide-react";
import type { Opportunity } from "@/lib/infranex/types";

interface OpportunityDetailDialogProps {
  opportunity: Opportunity | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OpportunityDetailDialog({
  opportunity,
  open,
  onOpenChange,
}: OpportunityDetailDialogProps) {
  if (!opportunity) return null;
  const o = opportunity;
  const band = scoreBand(o.score);
  const risk = getStatusColor(o.riskLevel);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto custom-scroll">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="mono">
              {o.subnetSymbol}
            </Badge>
            <Badge variant="outline" className={cn(band.bg, band.color)}>
              {band.label}
            </Badge>
            <Badge variant="outline" className={cn(risk.bg, risk.text, "capitalize")}>
              {o.riskLevel} risk
            </Badge>
          </div>
          <DialogTitle className="text-display text-2xl">
            {o.subnetName}
            <span className="ml-2 tabular text-primary">{o.score.toFixed(1)}</span>
          </DialogTitle>
          <DialogDescription>
            NetUID {o.netuid} · {o.category} · rank #{o.rank} · updated{" "}
            {new Date(o.updatedAt).toLocaleTimeString()}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="bg-card/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <TrendingUp className="h-4 w-4" />
                <span className="text-xs font-medium">Est. APY</span>
              </div>
              <p className="mt-1 tabular text-xl font-bold text-success">
                {formatPercent(o.estimatedApy)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Wallet className="h-4 w-4" />
                <span className="text-xs font-medium">Monthly reward</span>
              </div>
              <p className="mt-1 tabular text-xl font-bold">
                {formatCurrency(o.estimatedMonthlyRewardUsd)}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-card/40">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Cpu className="h-4 w-4" />
                <span className="text-xs font-medium">Daily reward</span>
              </div>
              <p className="mt-1 tabular text-xl font-bold">
                {o.estimatedDailyReward.toFixed(2)}{" "}
                <span className="text-sm font-normal text-muted-foreground">TAO</span>
              </p>
            </CardContent>
          </Card>
        </div>

        <Separator />

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-display text-lg font-semibold">
              Score breakdown
            </h3>
            <span className="text-eyebrow text-muted-foreground">
              3-pillar model
            </span>
          </div>
          <div className="space-y-4">
            {o.factors.map((f) => (
              <div key={f.name}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{f.name}</span>
                    {f.impact === "negative" && (
                      <AlertTriangle className="h-3 w-3 text-warning" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="mono text-[10px] text-muted-foreground">
                      w {Math.round(f.weight * 100)}%
                    </span>
                    <span
                      className={cn(
                        "tabular text-sm font-semibold",
                        f.raw >= 60
                          ? "text-success"
                          : f.raw <= 40
                            ? "text-destructive"
                            : "text-foreground"
                      )}
                    >
                      {f.raw.toFixed(0)}
                    </span>
                  </div>
                </div>
                <Progress
                  value={f.raw}
                  className="mt-1.5 h-1.5"
                  indicatorClassName={cn(
                    f.raw >= 60
                      ? "bg-success"
                      : f.raw <= 40
                        ? "bg-destructive"
                        : "bg-warning"
                  )}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-muted-foreground">Required stake</p>
            <p className="mono tabular font-medium">
              {o.requiredStake.toLocaleString()} TAO
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Utilization</p>
            <p className="tabular font-medium">
              {(o.utilization * 100).toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Confidence</p>
            <p className="tabular font-medium text-success">
              {formatPercent(o.confidence * 100)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="font-medium capitalize">{o.status}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Compact card for grid layouts. */
export function OpportunityCard({ opportunity: o }: { opportunity: Opportunity }) {
  const band = scoreBand(o.score);
  const risk = getStatusColor(o.riskLevel);
  return (
    <Card className="editorial-card transition-all hover:border-primary/40">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-display truncate text-lg">
                {o.subnetName}
              </CardTitle>
              <Badge variant="outline" className="mono text-[10px]">
                {o.subnetSymbol}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              NetUID {o.netuid} · {o.category}
            </p>
          </div>
          <div className="text-right">
            <p className="tabular text-2xl font-bold text-primary">
              {o.score.toFixed(1)}
            </p>
            <Badge variant="outline" className={cn("text-[10px]", band.bg, band.color)}>
              {band.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Est. APY</p>
            <p className="tabular font-medium text-success">
              {formatPercent(o.estimatedApy)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Monthly</p>
            <p className="tabular font-medium">
              {formatCurrency(o.estimatedMonthlyRewardUsd)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Stake</p>
            <p className="mono tabular text-muted-foreground">
              {o.requiredStake.toLocaleString()} TAO
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Risk</p>
            <span
              className={cn(
                "badge-status capitalize",
                risk.bg,
                risk.text
              )}
            >
              {o.riskLevel}
            </span>
          </div>
        </div>
        <Progress
          value={o.score}
          className="h-1"
          indicatorClassName={cn(band.color.replace("text-", "bg-"))}
        />
      </CardContent>
    </Card>
  );
}
