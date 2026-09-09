"use client";

import { RefreshCw, Network, TrendingUp, Coins, Activity, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/cards/metric-card";
import { DataSourceBanner } from "@/components/cards/data-source-banner";
import { OpportunityTable } from "@/components/tables/opportunity-table";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { EmissionDonut } from "@/components/charts/emission-donut";
import {
  opportunities as curatedOpportunities,
  revenueSeries,
  emissionShares,
  workers,
} from "@/lib/infranex/data";
import {
  useNetwork,
  mergeOpportunities,
  getLiveDashboardMetrics,
} from "@/lib/infranex/use-network";
import { cn, formatNumber, formatCurrency, formatTao } from "@/lib/utils";
import { useProfitabilityConfig } from "@/lib/infranex/use-profitability";
import type { Opportunity, ViewKey } from "@/lib/infranex/types";

interface DashboardViewProps {
  onSelectOpportunity: (o: Opportunity) => void;
  onStartMining?: (o: Opportunity) => void;
  onNavigate: (v: ViewKey) => void;
}

export function DashboardView({ onSelectOpportunity, onStartMining, onNavigate }: DashboardViewProps) {
  const { data: snap, isFetching, refetch } = useNetwork();
  const { data: profConfig } = useProfitabilityConfig();
  const m = getLiveDashboardMetrics(snap, profConfig);
  const liveOpps = mergeOpportunities(snap, profConfig);
  const top = liveOpps.slice(0, 8);

  return (
    <div className="space-y-10">
      {/* Hero */}
      <header className="aurora animate-rise grid grid-cols-1 gap-8 rounded-2xl px-1 pb-8 pt-2 lg:grid-cols-[1.5fr_1fr] lg:items-end">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 backdrop-blur">
            <span className={cn(snap?.source === "live" ? "pulse-dot text-success" : "h-2 w-2 rounded-full bg-warning")} />
            <span className="text-eyebrow text-muted-foreground">
              Section · 01 · Network Intelligence
            </span>
          </div>
          <h1 className="animate-rise text-display mt-4 text-4xl font-bold leading-[1.04] md:text-5xl xl:text-6xl">
            Bittensor,
            <br />
            <span className="text-gradient">read like a book.</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            A single pane for every subnet you track — scores, miners,
            profitability, and the workers that keep the picture current.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => onNavigate("opportunities")}
              className="gap-2 rounded-lg shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.5)] transition-all hover:shadow-[0_10px_32px_-8px_hsl(var(--primary)/0.65)]"
            >
              Explore opportunities
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded-lg border-border/60 bg-card/50 backdrop-blur"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              {isFetching ? "Syncing…" : "Refresh chain"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <DataSourceBanner />
        </div>
      </header>

      {/* Metrics */}
      <section className="stagger grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Chain Subnets"
          value={m.totalSubnets || m.trackedSubnets}
          icon={<Network className="h-4 w-4" />}
          subtitle={
            m.totalSubnets
              ? `${m.trackedSubnets} tracked · ${m.activeSubnets} active`
              : "on Finney"
          }
          change={m.taoChange24h}
          trend={m.taoChange24h >= 0 ? "up" : "down"}
        />
        <MetricCard
          title="TAO Price"
          value={m.taoUsd ? `$${m.taoUsd.toFixed(2)}` : "—"}
          icon={<Coins className="h-4 w-4" />}
          subtitle={
            m.taoMarketCap
              ? `MC ${formatCurrency(m.taoMarketCap)}`
              : "CoinGecko"
          }
          change={m.taoChange24h}
          trend={m.taoChange24h >= 0 ? "up" : "down"}
        />
        <MetricCard
          title="Live Miners"
          value={m.totalMiners}
          icon={<Activity className="h-4 w-4" />}
          subtitle={`Across ${m.trackedSubnets} tracked subnets`}
          change={m.taoChange24h}
          trend={m.taoChange24h >= 0 ? "up" : "down"}
        />
        <MetricCard
          title="Avg Score"
          value={m.avgScore}
          format="raw"
          icon={<TrendingUp className="h-4 w-4" />}
          subtitle={`${m.runCount} RUN · ${m.watchCount} WATCH`}
          change={m.taoChange24h}
          trend={m.taoChange24h >= 0 ? "up" : "down"}
        />
      </section>

      {/* Top opportunities + revenue */}
      <section className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card className="glass">
          <CardHeader className="flex flex-row items-end justify-between gap-3 space-y-0">
            <div>
              <p className="text-eyebrow text-muted-foreground">
                Table · ranked · top {top.length}
              </p>
              <CardTitle className="text-display mt-2 text-2xl font-bold">
                Best subnets by score
              </CardTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onNavigate("opportunities")}
              className="rounded-lg border-border/60 bg-card/50"
            >
              View all
              <ArrowRight className="ml-2 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            <OpportunityTable
              opportunities={top}
              onSelect={onSelectOpportunity}
              onStartMining={onStartMining}
              compact
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="glass">
            <CardHeader className="pb-2">
              <p className="text-eyebrow text-muted-foreground">
                Emission · last 30 days
              </p>
              <CardTitle className="text-display text-xl font-bold">
                Portfolio revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-2 flex items-baseline gap-2">
                <span className="tabular text-display text-3xl font-bold tracking-tight">
                  {formatCurrency(m.portfolioEarnings * 412)}
                </span>
                <span className="text-sm text-muted-foreground">
                  · {formatTao(m.portfolioEarnings)}
                </span>
              </div>
              <RevenueChart data={revenueSeries} height={200} />
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader className="pb-2">
              <p className="text-eyebrow text-muted-foreground">
                Distribution · TAO/block
              </p>
              <CardTitle className="text-display text-xl font-bold">
                Emission by subnet
              </CardTitle>
            </CardHeader>
            <CardContent>
              <EmissionDonut data={emissionShares} height={200} />
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {emissionShares.slice(0, 6).map((e) => (
                  <div key={e.netuid} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full ring-2 ring-background"
                      style={{ backgroundColor: e.color }}
                    />
                    <span className="truncate text-muted-foreground">{e.name}</span>
                    <span className="ml-auto mono tabular font-medium">{e.emission.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Decision bands + workers */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader>
            <p className="text-eyebrow text-muted-foreground">
              Decision engine
            </p>
            <CardTitle className="text-display text-2xl font-bold">
              3-pillar verdicts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DecisionRow
              label="RUN"
              hint="Score ≥ 75"
              count={m.runCount}
              total={liveOpps.length}
              color="text-success"
              bg="bg-success/10 ring-1 ring-success/20"
              bar="bg-success"
            />
            <DecisionRow
              label="WATCH"
              hint="Score 40–74"
              count={m.watchCount}
              total={liveOpps.length}
              color="text-warning"
              bg="bg-warning/10 ring-1 ring-warning/20"
              bar="bg-warning"
            />
            <DecisionRow
              label="AVOID"
              hint="Score < 40"
              count={m.avoidCount}
              total={liveOpps.length}
              color="text-destructive"
              bg="bg-destructive/10 ring-1 ring-destructive/20"
              bar="bg-destructive"
            />
            <div className="editorial-rule" />
            <div className="grid grid-cols-3 gap-3 text-center">
              <Stat label="Live miners" value={formatNumber(m.totalMiners)} />
              <Stat label="Chain subnets" value={formatNumber(m.totalSubnets)} />
              <Stat label="TAO mkt cap" value={m.taoMarketCap ? formatCurrency(m.taoMarketCap) : "—"} />
            </div>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <p className="text-eyebrow text-muted-foreground">System</p>
              <CardTitle className="text-display text-2xl font-bold">Workers</CardTitle>
            </div>
            <Button variant="ghost" size="sm" className="gap-2 rounded-lg">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {workers.map((w) => (
              <div
                key={w.name}
                className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2.5 transition-colors hover:border-border/70 hover:bg-card/50"
              >
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    w.status === "healthy"
                      ? "bg-success shadow-[0_0_8px_0_hsl(var(--success)/0.7)]"
                      : w.status === "degraded"
                        ? "bg-warning shadow-[0_0_8px_0_hsl(var(--warning)/0.7)]"
                        : "bg-destructive shadow-[0_0_8px_0_hsl(var(--destructive)/0.7)]"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{w.name}</p>
                  <p className="text-xs text-muted-foreground">
                    last run {w.lastRun} ·{" "}
                    <span className="mono tabular">{w.latencyMs}ms</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="mono tabular text-sm font-semibold">
                    {formatNumber(w.tasksProcessed)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">tasks</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function DecisionRow({
  label,
  hint,
  count,
  total,
  color,
  bg,
  bar,
}: {
  label: string;
  hint: string;
  count: number;
  total: number;
  color: string;
  bg: string;
  bar: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px]", bg, color)}>
            {label}
          </Badge>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
        <span className="tabular text-sm font-semibold">
          {count}
          <span className="text-muted-foreground">/{total}</span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all duration-700", bar)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="tabular text-display text-lg font-bold tracking-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
