'use client'

import { useMemo } from 'react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { MetricCard } from '@/components/cards/metric-card'
import { OpportunityTable } from '@/components/tables/opportunity-table'
import { RevenueChart } from '@/components/charts/revenue-chart'
import { TrendingUp, Network, Coins, Activity, RefreshCw, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useTopOpportunities, useRecalculateOpportunity } from '@/hooks/useOpportunities'
import { useSubnets } from '@/hooks/useSubnets'
import { useWorkerStatus } from '@/hooks/useChangeDetection'
import { adaptOpportunityRow } from '@/lib/adapters'
import { WorkerStatusCard } from '@/components/cards/worker-status-card'

export default function DashboardPage() {
  const { data: top, isLoading: loadingTop, error: topError, refetch: refetchTop } = useTopOpportunities(10)
  const { data: subnetsPage, isLoading: loadingSubnets } = useSubnets({ page: 1, page_size: 50 })
  const { data: workers } = useWorkerStatus()
  const recalculate = useRecalculateOpportunity()

  const opportunities = useMemo(
    () => (top ?? []).map(adaptOpportunityRow),
    [top]
  )
  const subnetCount = subnetsPage?.total ?? 0
  const activeOpportunityCount = opportunities.filter((o) => o.score >= 50).length
  const avgScore = opportunities.length
    ? opportunities.reduce((s, o) => s + o.score, 0) / opportunities.length
    : 0
  const topScore = opportunities[0]?.score ?? 0

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Bittensor intelligence & mining opportunity overview
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchTop()}
              disabled={loadingTop}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loadingTop ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
        </div>

        <Tabs defaultValue="top" className="space-y-4">
          <TabsList>
            <TabsTrigger value="top">Top Opportunities</TabsTrigger>
            <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="top" className="space-y-4">
            {topError ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                  <p>Unable to load opportunities from backend.</p>
                  <p className="text-xs mt-1">
                    {topError instanceof Error ? topError.message : 'Unknown error'}
                  </p>
                </CardContent>
              </Card>
            ) : loadingTop ? (
              <Card>
                <CardContent className="py-8 space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </CardContent>
              </Card>
            ) : opportunities.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground space-y-3">
                  <p className="text-sm">No opportunity scores yet.</p>
                  <p className="text-xs">
                    Run the scoring worker to compute scores from your tracked subnets, or
                    trigger a one-off recalculation.
                  </p>
                  {opportunities[0] && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => recalculate.mutate(opportunities[0].netuid)}
                      disabled={recalculate.isPending}
                    >
                      {recalculate.isPending ? 'Recalculating…' : 'Recalculate Top Subnet'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Top {opportunities.length} Subnets by Score</CardTitle>
                </CardHeader>
                <CardContent>
                  <OpportunityTable opportunities={opportunities} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

           <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Score Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <RevenueChart
                  data={opportunities.slice(0, 7).map((o, i) => ({
                    name: o.subnet_name,
                    value: o.score,
                    timestamp: new Date(Date.now() - i * 86400000).toISOString(),
                  }))}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Worker Status */}
        {workers && workers.length > 0 && (
          <WorkerStatusCard workers={workers} />
        )}
      </div>
    </DashboardLayout>
  )
}
