'use client'

import { use } from 'react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { MetricCard } from '@/components/cards/metric-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, RefreshCw, Activity, Thermometer, Cpu, DollarSign, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useMinerHealth } from '@/hooks/useMonitoring'
import { RevenueChart } from '@/components/charts/revenue-chart'
import { getStatusColor } from '@/lib/utils'
import type { MinerHealthSummary } from '@/types'

interface MinerDetailPageProps {
  params: Promise<{ id: string }>
}

export default function MinerDetailPage({ params }: MinerDetailPageProps) {
  const { id } = use(params)
  const { data: healthData, isLoading, refetch } = useMinerHealth(id)

  const health = healthData as MinerHealthSummary | undefined

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-10" />
            <div>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64 mt-2" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      </DashboardLayout>
    )
  }

  if (!health) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/miners">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Miner Not Found</h1>
              <p className="text-muted-foreground">The requested miner could not be found.</p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const statusColor = getStatusColor(health.status)

  const gpuHistory = health.latest_gpu && health.gpu_utilization_avg != null
    ? [{ timestamp: new Date().toISOString(), value: health.gpu_utilization_avg }]
    : []

  const emissionHistory = health.emission != null
    ? [{ timestamp: new Date().toISOString(), value: health.emission }]
    : []

  const incentiveHistory = health.incentive != null
    ? [{ timestamp: new Date().toISOString(), value: health.incentive * 100 }]
    : []

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/miners">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-3xl font-bold tracking-tight">Miner {id.slice(0, 8)}</h1>
                <Badge className={`${statusColor.bg} ${statusColor.text} border-0`}>
                  {health.status}
                </Badge>
              </div>
              <p className="text-muted-foreground font-mono text-xs">
                {health.hotkey_address}
              </p>
            </div>
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
          <MetricCard
            title="Health Score"
            value={health.health_score?.toFixed(1) ?? '—'}
            icon={<Activity className="h-5 w-5" />}
            subtitle="Current health"
          />
          <MetricCard
            title="GPU Utilization"
            value={health.gpu_utilization_avg != null ? `${health.gpu_utilization_avg.toFixed(1)}%` : '—'}
            icon={<Cpu className="h-5 w-5" />}
            subtitle="Average utilization"
          />
          <MetricCard
            title="GPU Temperature"
            value={health.gpu_temperature_avg != null ? `${health.gpu_temperature_avg.toFixed(1)}°C` : '—'}
            icon={<Thermometer className="h-5 w-5" />}
            subtitle="Average temperature"
          />
          <MetricCard
            title="Emission"
            value={health.emission?.toFixed(4) ?? '—'}
            icon={<TrendingUp className="h-5 w-5" />}
            subtitle="Latest emission"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Health History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart
                data={gpuHistory}
                height={250}
                color="hsl(var(--primary))"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Emission History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart
                data={emissionHistory}
                height={250}
                color="hsl(var(--success))"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Incentive (ROI Proxy)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueChart
                data={incentiveHistory}
                height={250}
                color="hsl(var(--warning))"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Latest GPU Telemetry</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {Object.entries(health.latest_gpu || {}).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="font-medium">
                      {typeof value === 'number' ? value.toFixed(2) : String(value ?? '—')}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
