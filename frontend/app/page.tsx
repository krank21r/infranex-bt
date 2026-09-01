'use client'

import { useMemo } from 'react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { MetricCard } from '@/components/cards/metric-card'
import { OpportunityTable } from '@/components/tables/opportunity-table'
import { RevenueChart } from '@/components/charts/revenue-chart'
import {
  TrendingUp,
  Network,
  Coins,
  Activity,
  RefreshCw,
  AlertCircle,
  ArrowUpRight,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  useTopOpportunities,
  useRecalculateOpportunity,
} from '@/hooks/useOpportunities'
import { useSubnets } from '@/hooks/useSubnets'
import { useWorkerStatus } from '@/hooks/useChangeDetection'
import { adaptOpportunityRow } from '@/lib/adapters'
import { WorkerStatusCard } from '@/components/cards/worker-status-card'
import { DataSourceBanner } from '@/components/cards/data-source-banner'

// Stable anchor so the illustrative trend chart uses deterministic timestamps
// (calling Date.now() during render would make rendering non-idempotent).
const TREND_ANCHOR = Date.now()

export default function DashboardPage() {
  const {
    data: top,
    isLoading: loadingTop,
    error: topError,
    refetch: refetchTop,
  } = useTopOpportunities(10)
  const { data: subnetsPage, isLoading: loadingSubnets } = useSubnets({
    page: 1,
    page_size: 50,
  })
  const { data: workers } = useWorkerStatus()
  const recalculate = useRecalculateOpportunity()

  const opportunities = useMemo(
    () => (top ?? []).map(adaptOpportunityRow),
    [top]
  )
  const subnetCount = subnetsPage?.total ?? 0
  const activeOpportunityCount = opportunities.filter(
    (o) => o.score >= 50
  ).length
  const avgScore = opportunities.length
    ? opportunities.reduce((s, o) => s + o.score, 0) / opportunities.length
    : 0
  const topScore = opportunities[0]?.score ?? 0

  return (
    <DashboardLayout>
      <div className="space-y-10">
        <header className="grid grid-cols-1 gap-8 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div>
            <p className="text-eyebrow text-muted-foreground">
              Section · 01 · Network Intelligence
            </p>
            <h1 className="text-display mt-3 text-5xl leading-[1.05] md:text-7xl">
              Bittensor,
              <br />
              <em className="font-medium text-primary not-italic">
                read like a book.
              </em>
            </h1>
            <p className="mt-5 max-w-2xl text-base text-muted-foreground">
              A single pane for every subnet you track — scores, miners,
              profitability, and the workers that keep the picture current.
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <DataSourceBanner />
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchTop()}
              disabled={loadingTop}
              className="self-start lg:self-end"
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${loadingTop ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Tracked Subnets"
            value={loadingSubnets ? '…' : subnetCount.toString()}
            icon={<Network className="h-4 w-4" />}
            subtitle="From Bittensor chain"
          />
          <MetricCard
            title="Active Opportunities"
            value={loadingTop ? '…' : activeOpportunityCount.toString()}
            icon={<TrendingUp className="h-4 w-4" />}
            subtitle="Score ≥ 50"
          />
          <MetricCard
            title="Top Score"
            value={loadingTop ? '…' : topScore.toFixed(1)}
            icon={<Coins className="h-4 w-4" />}
            subtitle="Best subnet opportunity"
          />
          <MetricCard
            title="Average Score"
            value={loadingTop ? '…' : avgScore.toFixed(1)}
            icon={<Activity className="h-4 w-4" />}
            subtitle="Across tracked subnets"
          />
        </section>

        <Tabs defaultValue="top" className="space-y-4">
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList>
              <TabsTrigger value="top">Top Opportunities</TabsTrigger>
              <TabsTrigger value="activity">Recent Activity</TabsTrigger>
            </TabsList>
            <a
              href="/opportunities"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              Full ranked table
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>

          <TabsContent value="top" className="space-y-4">
            {topError ? (
              <Card className="border-warning/30 bg-warning/[0.04]">
                <CardContent className="py-12 text-center text-muted-foreground">
                  <AlertCircle className="h-7 w-7 mx-auto mb-3 text-warning" />
                  <p className="text-display text-xl">Unable to load data.</p>
                  <p className="text-xs mt-2">
                    {topError instanceof Error
                      ? topError.message
                      : 'Unknown error'}
                  </p>
                </CardContent>
              </Card>
            ) : loadingTop ? (
              <Card>
                <CardContent className="py-10 space-y-4">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </CardContent>
              </Card>
            ) : opportunities.length === 0 ? (
              <Card className="border-border/60 bg-card/40">
                <CardContent className="py-16 text-center text-muted-foreground space-y-3">
                  <p className="text-display text-2xl">No scores yet.</p>
                  <p className="text-sm max-w-md mx-auto">
                    Run the scoring worker to compute scores from your
                    tracked subnets, or trigger a one-off recalculation.
                  </p>
                  {opportunities[0] && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => recalculate.mutate(opportunities[0].netuid)}
                      disabled={recalculate.isPending}
                    >
                      {recalculate.isPending
                        ? 'Recalculating…'
                        : 'Recalculate Top Subnet'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border/60 bg-card/40">
                <CardHeader className="flex flex-row items-end justify-between gap-3 space-y-0">
                  <div>
                    <p className="text-eyebrow text-muted-foreground">
                      Table · ranked · top {opportunities.length}
                    </p>
                    <CardTitle className="text-display mt-2 text-2xl">
                      Best Subnets by Score
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <OpportunityTable opportunities={opportunities} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="activity" className="space-y-4">
            <Card className="border-border/60 bg-card/40">
              <CardHeader>
                <p className="text-eyebrow text-muted-foreground">
                  Chart · last 7 days
                </p>
                <CardTitle className="text-display text-2xl">
                  Recent Score Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RevenueChart
                  data={opportunities.slice(0, 7).map((o, i) => ({
                    name: o.subnet_name,
                    value: o.score,
                    timestamp: new Date(
                      TREND_ANCHOR - i * 86400000
                    ).toISOString(),
                  }))}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {workers && workers.length > 0 && <WorkerStatusCard workers={workers} />}
      </div>
    </DashboardLayout>
  )
}