"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { EmissionDonut } from "@/components/charts/emission-donut";
import { DataSourceBanner } from "@/components/cards/data-source-banner";
import {
  useNetwork,
  mergeSubnets,
  mergeOpportunities,
  getLiveDashboardMetrics,
  buildEmissionShares,
} from "@/lib/infranex/use-network";
import { useProfitabilityConfig } from "@/lib/infranex/use-profitability";
import { cn, formatCurrency, scoreBand } from "@/lib/utils";
import { BarChart3, TrendingUp, PieChart, Layers } from "lucide-react";

// MOCK-PURGE-2 — this view previously rendered module-level fabricated
// constants (randomized revenue series, static emission donut, offline
// score bars). Every panel now derives from the LIVE chain snapshot with
// honest empty states when data has not synced yet.

function ScoreTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { band: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 shadow-lg">
      <p className="mono text-xs font-medium">{label}</p>
      <p className="tabular mt-0.5 text-sm">
        Score: <span className="font-semibold">{payload[0].value.toFixed(1)}</span>
      </p>
      <p className="text-xs text-muted-foreground">{payload[0].payload.band}</p>
    </div>
  );
}

export function AnalyticsView() {
  const { data: snap } = useNetwork();
  const { data: profConfig } = useProfitabilityConfig();
  const m = getLiveDashboardMetrics(snap, profConfig);

  const liveSubnets = useMemo(() => mergeSubnets(snap), [snap]);
  const liveOpps = useMemo(
    () => mergeOpportunities(snap, profConfig),
    [snap, profConfig]
  );

  const scoreBars = useMemo(
    () =>
      liveOpps
        .slice(0, 12)
        .map((o) => ({
          name: o.subnetSymbol,
          score: o.score,
          band: scoreBand(o.score).label,
        })),
    [liveOpps]
  );

  const categoryBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { count: number; emission: number; avgScore: number }
    >();
    liveSubnets.forEach((s) => {
      const opp = liveOpps.find((o) => o.netuid === s.netuid);
      const cur = map.get(s.category) ?? { count: 0, emission: 0, avgScore: 0 };
      cur.count += 1;
      cur.emission += s.emission;
      cur.avgScore += opp?.score ?? 0;
      map.set(s.category, cur);
    });
    return Array.from(map.entries()).map(([cat, v]) => ({
      category: cat,
      count: v.count,
      emission: Math.round(v.emission * 100) / 100,
      avgScore: Math.round((v.avgScore / v.count) * 10) / 10,
    }));
  }, [liveSubnets, liveOpps]);

  const emissionSharesLive = useMemo(
    () => buildEmissionShares(liveSubnets),
    [liveSubnets]
  );

  const avgConfidence =
    liveOpps.length > 0
      ? `${Math.round(
          (liveOpps.reduce((a, o) => a + o.confidence, 0) / liveOpps.length) * 100
        )}%`
      : "—";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">Section · 11</p>
          <h1 className="animate-rise text-display text-3xl font-bold tracking-tight md:text-4xl">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live network metrics, emission distribution, and opportunity
            scores across every tracked subnet.
          </p>
        </div>
        <DataSourceBanner />
      </header>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
          <CardHeader>
            <p className="text-eyebrow text-muted-foreground">
              Realized earnings · daemon telemetry
            </p>
            <CardTitle className="text-display flex items-center gap-2 text-xl">
              <TrendingUp className="h-4 w-4 text-primary" />
              Revenue trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/50 px-6 text-center">
              <TrendingUp className="h-5 w-5 text-muted-foreground/50" />
              <p className="max-w-[280px] text-xs text-muted-foreground">
                No realized revenue yet — the earnings time series builds up
                once miners are running and their daemons report telemetry.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
          <CardHeader>
            <p className="text-eyebrow text-muted-foreground">
              Distribution · live snapshot
            </p>
            <CardTitle className="text-display flex items-center gap-2 text-xl">
              <PieChart className="h-4 w-4 text-primary" />
              Emission by subnet
            </CardTitle>
          </CardHeader>
          <CardContent>
            {emissionSharesLive.length === 0 ? (
              <div className="flex h-[260px] items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Awaiting the live chain snapshot — the emission distribution
                appears once the scanner syncs.
              </div>
            ) : (
              <EmissionDonut data={emissionSharesLive} height={260} />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
          <CardHeader>
            <p className="text-eyebrow text-muted-foreground">
              Top 12 · by score
            </p>
            <CardTitle className="text-display flex items-center gap-2 text-xl">
              <BarChart3 className="h-4 w-4 text-primary" />
              Opportunity scores
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scoreBars.length === 0 ? (
              <div className="flex h-[280px] items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Awaiting the live chain snapshot — opportunity scores appear
                once the scanner syncs.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={scoreBars} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.4} />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip content={<ScoreTooltip />} cursor={{ fill: "hsl(var(--muted) / 0.3)" }} />
                  <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={36}>
                    {scoreBars.map((b, i) => (
                      <Cell
                        key={i}
                        fill={
                          b.band === "RUN"
                            ? "hsl(var(--success))"
                            : b.band === "WATCH"
                              ? "hsl(var(--warning))"
                              : "hsl(var(--destructive))"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
          <CardHeader>
            <p className="text-eyebrow text-muted-foreground">By category</p>
            <CardTitle className="text-display flex items-center gap-2 text-xl">
              <Layers className="h-4 w-4 text-primary" />
              Category breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {categoryBreakdown.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Awaiting the live chain snapshot — the category breakdown
                appears once the scanner syncs.
              </div>
            ) : (
              categoryBreakdown
                .sort((a, b) => b.emission - a.emission)
                .map((c) => {
                  const maxEm = Math.max(...categoryBreakdown.map((x) => x.emission));
                  const pct = maxEm > 0 ? (c.emission / maxEm) * 100 : 0;
                  return (
                    <div key={c.category}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{c.category}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {c.count} subnets
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="tabular text-muted-foreground">
                            avg {c.avgScore.toFixed(1)}
                          </span>
                          <span className="mono tabular font-medium text-primary">
                            {c.emission.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <Progress
                        value={pct}
                        className="mt-1.5 h-1.5"
                        indicatorClassName={cn(
                          c.avgScore >= 70
                            ? "bg-success"
                            : c.avgScore >= 45
                              ? "bg-primary"
                              : "bg-warning"
                        )}
                      />
                    </div>
                  );
                })
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
        <CardHeader>
          <p className="text-eyebrow text-muted-foreground">Network totals</p>
          <CardTitle className="text-display text-xl">Platform summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryStat
              label="Total subnets"
              value={String(m.totalSubnets || liveSubnets.length)}
              sub={m.isLive ? "on the live Finney chain" : "tracked on Finney"}
            />
            <SummaryStat
              label="Total miners"
              value={m.totalMiners.toLocaleString()}
              sub="across all subnets"
            />
            <SummaryStat
              label="Total market cap"
              value={
                m.totalMarketCap > 0 ? formatCurrency(m.totalMarketCap) : "—"
              }
              sub="aggregate"
            />
            <SummaryStat
              label="Avg confidence"
              value={avgConfidence}
              sub="score model"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="tabular mt-1 text-xl font-bold">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}
