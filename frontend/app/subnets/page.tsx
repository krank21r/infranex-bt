'use client'

import { useMemo, useState } from 'react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, RefreshCw, AlertCircle, Network, ChevronRight } from 'lucide-react'
import { useSubnets } from '@/hooks/useSubnets'
import { adaptSubnet } from '@/lib/adapters'

export default function SubnetsPage() {
  const [search, setSearch] = useState('')
  const [isActive, setIsActive] = useState<boolean | undefined>(undefined)

  const { data, isLoading, error, refetch, isRefetching } = useSubnets({
    page: 1,
    page_size: 50,
    search: search || undefined,
    is_active: isActive,
    sort_by: 'netuid',
    sort_order: 'asc',
  })

  const subnets = useMemo(() => (data?.data ?? []).map(adaptSubnet), [data])

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Subnets</h1>
            <p className="text-muted-foreground">
              All Bittensor subnets tracked by the platform
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
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name or description…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                  aria-label="Search subnets"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant={isActive === undefined ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setIsActive(undefined)}
                >
                  All
                </Button>
                <Button
                  variant={isActive === true ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setIsActive(true)}
                >
                  Active
                </Button>
                <Button
                  variant={isActive === false ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setIsActive(false)}
                >
                  Inactive
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
              <p>Unable to load subnets from backend.</p>
              <p className="text-xs mt-1">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-3/4" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : subnets.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground space-y-2">
              <Network className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              <p>No subnets found.</p>
              <p className="text-xs">
                Run the Bittensor scanner worker to populate this list.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              Showing {subnets.length} of {data?.total ?? subnets.length} subnets
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {subnets.map((s) => (
                <Card key={s.id} className="hover:border-primary/50 transition-colors">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="truncate">{s.name}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          NetUID: {s.netuid}
                        </p>
                      </div>
                      <Badge
                        variant={s.status === 'active' ? 'default' : 'outline'}
                        className="shrink-0"
                      >
                        {s.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                      {s.description || 'No description available.'}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <div>
                        <span className="text-muted-foreground">Miners</span>
                        <p className="font-medium">{s.miners_count}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Validators</span>
                        <p className="font-medium">{s.validators_count}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Tempo</span>
                        <p className="font-medium">{s.tempo || '—'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Emission</span>
                        <p className="font-medium">
                          {s.emission ? s.emission.toFixed(4) : '—'}
                        </p>
                      </div>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="w-full">
                      <a href={`/subnets/${s.netuid}`}>
                        View Details <ChevronRight className="h-4 w-4 ml-1" />
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  )
}
