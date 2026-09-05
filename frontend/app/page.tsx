'use client'

import { useMemo } from 'react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { MetricCard } from '@/components/cards/metric-card'
import { OpportunityTable } from '@/components/tables/opportunity-table'
import {
  TrendingUp,
  Network,
  Coins,
  Activity,
  RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  useTopOpportunities,
  useRecalculateOpportunity,
} from '@/hooks/useOpportunities'
import { useSubnets } from '@/hooks/useSubnets'
import { adaptOpportunityRow } from '@/lib/adapters'
import { DataSourceBanner } from '@/components/cards/data-source-banner'

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
            <Button
              variant="outline"
              size="sm"
              onClick={() => opportunities[0] && recalculate.mutate(opportunities[0].netuid)}
              disabled={recalculate.isPending || opportunities.length === 0}
            >
              {recalculate.isPending ? 'Recalculating…' : 'Recalculate Top'}
            </Button>
          </CardHeader>
          <CardContent>
            {topError ? (
              <div className="py-12 text-center text-muted-foreground">
                <p className="text-display text-xl">Unable to load data.</p>
                <p className="text-xs mt-2">
                  {topError instanceof Error
                    ? topError.message
                    : 'Unknown error'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchTop()}
                  className="mt-4"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            ) : loadingTop ? (
              <div className="space-y-4 py-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-4/6" />
              </div>
            ) : opportunities.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <p className="text-display text-2xl">No scores yet.</p>
                <p className="text-sm max-w-md mx-auto mt-2">
                  Run the scoring worker to compute scores from your tracked
                  subnets, or trigger a recalculation.
                </p>
              </div>
            ) : (
              <OpportunityTable opportunities={opportunities} />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
