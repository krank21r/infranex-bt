'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Coins, RefreshCw, Power, ArrowRightLeft, Activity, AlertTriangle } from 'lucide-react'
import { useMonitoringOverview } from '@/hooks/useMonitoring'
import { getStatusColor } from '@/lib/utils'
import Link from 'next/link'
import type { MonitoringOverview, MinerHealthSummary } from '@/types'

export default function MinersPage() {
  const { data: overview, isLoading, refetch } = useMonitoringOverview()
  const overviewData = overview as MonitoringOverview | undefined

  const miners: MinerHealthSummary[] = overviewData?.miners || []

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Miners</h1>
            <p className="text-muted-foreground">
              Tracked miner positions, health, and earnings
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Miners</p>
                  <p className="text-xl font-bold">{overviewData?.total_miners ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-success" />
                <div>
                  <p className="text-xs text-muted-foreground">Active</p>
                  <p className="text-xl font-bold">{overviewData?.active_miners ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <div>
                  <p className="text-xs text-muted-foreground">Down</p>
                  <p className="text-xl font-bold">{overviewData?.down_miners ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Power className="h-4 w-4 text-destructive" />
                <div>
                  <p className="text-xs text-muted-foreground">Inactive</p>
                  <p className="text-xl font-bold">{overviewData?.inactive_miners ?? 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Miner Registry
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            ) : miners.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <p className="text-sm font-medium">No miners tracked yet</p>
                <p className="text-xs mt-1">
                  Deploy miners through the deployment manager to see them here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {miners.map((miner) => {
                  const statusColor = getStatusColor(miner.status)
                  return (
                    <div
                      key={miner.miner_id}
                      className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                          <Link
                            href={`/miners/${miner.miner_id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {miner.hotkey_address.slice(0, 16)}...
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            Netuid {miner.netuid} • UID {miner.miner_id.slice(0, 8)}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
                          <span>Health: {miner.health_score?.toFixed(0) ?? '—'}</span>
                          <span>GPU: {miner.gpu_utilization_avg?.toFixed(1) ?? '—'}%</span>
                          <span>Temp: {miner.gpu_temperature_avg?.toFixed(1) ?? '—'}°C</span>
                        </div>

                        <Badge className={`${statusColor.bg} ${statusColor.text} border-0`}>
                          {miner.status}
                        </Badge>

                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Restart">
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Stop">
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Migrate" asChild>
                            <Link href={`/miners/${miner.miner_id}`}>
                              <ArrowRightLeft className="h-4 w-4" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}

