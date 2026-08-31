'use client'

import { useMemo, useState } from 'react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { OpportunityTable } from '@/components/tables/opportunity-table'
import { RefreshCw, AlertCircle, TrendingUp } from 'lucide-react'
import { useOpportunities, useRecalculateOpportunity } from '@/hooks/useOpportunities'
import { adaptOpportunityRow } from '@/lib/adapters'

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

  const opportunities = useMemo(
    () => (data?.data ?? []).map(adaptOpportunityRow),
    [data]
  )

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Opportunities</h1>
            <p className="text-muted-foreground">
              Subnet opportunity scores from the v1.0 explainable engine
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground mr-2">
                Minimum score:
              </span>
              {[undefined, 30, 50, 70, 85].map((threshold) => (
                <Button
                  key={threshold ?? 'all'}
                  variant={minScore === threshold ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setMinScore(threshold)}
                >
                  {threshold === undefined ? 'All' : `≥ ${threshold}`}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
              <p>Unable to load opportunities from backend.</p>
              <p className="text-xs mt-1">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
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
              <TrendingUp className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm">No opportunity scores match this filter.</p>
              <p className="text-xs">
                Run the scoring worker or trigger a recalculation.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Showing {opportunities.length} of {data?.total ?? opportunities.length} opportunities
              </div>
              <div className="flex gap-2">
                <Badge variant="outline">{data?.page ?? 1}</Badge>
                <span className="text-xs text-muted-foreground self-center">
                  page of {data?.totalPages ?? 1}
                </span>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Opportunity Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <OpportunityTable
                  opportunities={opportunities}
                  onRowClick={(opp) =>
                    recalculate.mutate(opp.netuid)
                  }
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
