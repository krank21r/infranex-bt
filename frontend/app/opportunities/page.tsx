'use client'

import { useMemo, useState } from 'react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { OpportunityTable } from '@/components/tables/opportunity-table'
import { RefreshCw, AlertCircle, TrendingUp, ArrowUpRight } from 'lucide-react'
import {
  useOpportunities,
  useRecalculateOpportunity,
} from '@/hooks/useOpportunities'
import { DataSourceBanner } from '@/components/cards/data-source-banner'

export default function OpportunitiesPage() {
  const [minScore, setMinScore] = useState<number | undefined>(undefined)
  const recalculate = useRecalculateOpportunity()

  const { data, isLoading, error, refetch, isRefetching } = useOpportunities({
    page: 1,
    page_size: 50,
    min_score: minScore,
    sort_by: 'score',
    sort_order: 'desc',
  })

  const opportunities = useMemo(() => data?.data ?? [], [data])

  const scoreStats = useMemo(() => {
    if (opportunities.length === 0) {
      return { count: 0, avg: 0, top: 0, qualified: 0 }
    }
    const sum = opportunities.reduce((acc, o) => acc + (o.score ?? 0), 0)
    const top = opportunities.reduce((m, o) => Math.max(m, o.score ?? 0), 0)
    const qualified = opportunities.filter((o) => (o.score ?? 0) >= 50).length
    return {
      count: opportunities.length,
      avg: sum / opportunities.length,
      top,
      qualified,
    }
  }, [opportunities])

  return (
    <DashboardLayout>
      <div className="space-y-10">
        <header className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <p className="text-eyebrow text-muted-foreground">
              Section · 02 · Opportunity Engine
            </p>
            <h1 className="text-display mt-3 text-5xl leading-[1.05] md:text-6xl">
              Where capital
              <br />
              <em className="font-medium text-primary not-italic">
                compounds quietly
              </em>
              .
            </h1>
            <p className="mt-5 max-w-2xl text-base text-muted-foreground">
              Live explainable scoring across every tracked Bittensor subnet.
              Updated continuously by the orchestrator; the same data the
              deploy engine uses to underwrite new miners.
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:items-end">
            <DataSourceBanner />
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="self-start lg:self-end"
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <StatCell
            label="Tracked"
            value={isLoading ? '—' : scoreStats.count.toString()}
            hint="opportunities with score"
          />
          <StatCell
            label="Top"
            value={isLoading ? '—' : scoreStats.top.toFixed(1)}
            tone="primary"
            hint="highest current score"
          />
          <StatCell
            label="Average"
            value={isLoading ? '—' : scoreStats.avg.toFixed(1)}
            hint="mean across visible set"
          />
          <StatCell
            label="Qualified"
            value={isLoading ? '—' : scoreStats.qualified.toString()}
            hint="score ≥ 50"
          />
        </section>

        <Card className="border-border/60 bg-card/40">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-eyebrow text-muted-foreground mr-2">
                Filter · minimum score
              </span>
              {[undefined, 30, 50, 70, 85].map((threshold) => (
                <Button
                  key={threshold ?? 'all'}
                  variant={minScore === threshold ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMinScore(threshold)}
                  className="mono"
                >
                  {threshold === undefined ? 'All' : `≥ ${threshold}`}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {error ? (
          <ErrorPanel
            message={error instanceof Error ? error.message : 'Unknown error'}
            onRetry={() => refetch()}
            isRetrying={isRefetching}
          />
        ) : isLoading ? (
          <Card>
            <CardContent className="py-10 space-y-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/6" />
              <Skeleton className="h-4 w-3/6" />
            </CardContent>
          </Card>
        ) : opportunities.length === 0 ? (
          <EmptyPanel />
        ) : (
          <Card className="border-border/60 bg-card/40">
            <CardHeader className="flex flex-row items-end justify-between gap-3 space-y-0">
              <div>
                <p className="text-eyebrow text-muted-foreground">
                  Table · ranked
                </p>
                <CardTitle className="text-display mt-2 text-2xl">
                  Opportunity Scores
                </CardTitle>
              </div>
              <Badge variant="outline" className="mono">
                page {data?.page ?? 1} / {data?.totalPages ?? 1}
              </Badge>
            </CardHeader>
            <CardContent>
              <OpportunityTable
                opportunities={opportunities}
                onRowClick={(opp) => recalculate.mutate(opp.netuid)}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  )
}

function StatCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'primary'
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-5">
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <p
        className={`tabular mt-3 text-3xl leading-none ${
          tone === 'primary' ? 'text-primary' : 'text-foreground'
        }`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

function ErrorPanel({
  message,
  onRetry,
  isRetrying,
}: {
  message: string
  onRetry: () => void
  isRetrying: boolean
}) {
  return (
    <Card className="border-warning/30 bg-warning/[0.04]">
      <CardContent className="py-12">
        <div className="flex flex-col items-center text-center">
          <AlertCircle className="h-7 w-7 text-warning" />
          <p className="text-display mt-4 text-2xl">No live data yet.</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            We could not read opportunities from the configured source. If
            you just deployed, allow a few seconds for the orchestrator to
            populate <span className="mono">opportunity_scores</span>.
          </p>
          <p className="mt-3 max-w-md text-xs text-muted-foreground/80">
            {message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            disabled={isRetrying}
            className="mt-6"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isRetrying ? 'animate-spin' : ''}`}
            />
            Retry
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function EmptyPanel() {
  return (
    <Card className="border-border/60 bg-card/40">
      <CardContent className="py-16">
        <div className="flex flex-col items-center text-center">
          <TrendingUp className="h-7 w-7 text-muted-foreground" />
          <p className="text-display mt-4 text-2xl">Quiet waters.</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            No opportunity scores match this filter yet. Trigger a
            recalculation to refresh the engine, or loosen the minimum
            score threshold.
          </p>
          <a
            href="/dashboard"
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            Back to dashboard
            <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </CardContent>
    </Card>
  )
}