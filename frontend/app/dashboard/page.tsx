'use client'

import { useState } from 'react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { MetricCard } from '@/components/cards/metric-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertCircle, Activity, Cpu, Thermometer, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'
import { useMonitoringOverview, useActiveAlerts, useResolveAlert, useMonitoringEvents } from '@/hooks/useMonitoring'
import { RevenueChart } from '@/components/charts/revenue-chart'
import type { Alert, MonitoringOverview } from '@/types'

function AlertItem({ alert, onResolve }: { alert: Alert; onResolve: (id: string) => void }) {
  const severityColors = {
    critical: 'bg-destructive/10 text-destructive border-destructive/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    info: 'bg-primary/10 text-primary border-primary/20',
  }

  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 ${severityColors[alert.severity as keyof typeof severityColors] || severityColors.info}`}>
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{alert.message}</p>
        <p className="text-xs opacity-70 mt-1">
          {alert.alert_type.replace(/_/g, ' ')} • {new Date(alert.created_at).toLocaleTimeString()}
        </p>
      </div>
      {!alert.is_resolved && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onResolve(alert.id)}
          className="shrink-0 h-7 text-xs"
        >
          Resolve
        </Button>
      )}
    </div>
  )
}

export default function MonitoringDashboardPage() {
  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useMonitoringOverview()
  const { data: alertsData, refetch: refetchAlerts } = useActiveAlerts()
  const resolveAlert = useResolveAlert()
  const [gpuHistory, setGpuHistory] = useState<{ timestamp: string; value: number }[]>([])

  useMonitoringEvents((event) => {
    if (event && typeof event === 'object' && 'type' in event) {
      const ev = event as { type: string; payload: Record<string, unknown> }
      if (ev.type === 'miner_health') {
        const payload = ev.payload as { gpu_utilization_avg?: number; timestamp?: string }
        if (payload.gpu_utilization_avg != null && payload.timestamp) {
          setGpuHistory((prev) => [...prev.slice(-29), { timestamp: payload.timestamp!, value: payload.gpu_utilization_avg! }])
        }
      }
      if (ev.type === 'alert') {
        refetchAlerts()
      }
    }
  })

  const overviewData = overview as MonitoringOverview | undefined
  const alerts = alertsData as Alert[] | undefined

  const handleResolve = async (alertId: string) => {
    await resolveAlert.mutateAsync(alertId)
    refetchAlerts()
    refetchOverview()
  }

  const activeAlerts = alerts?.filter((a) => !a.is_resolved) || []
  const criticalCount = activeAlerts.filter((a) => a.severity === 'critical').length
  const warningCount = activeAlerts.filter((a) => a.severity === 'warning').length

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Monitoring</h1>
            <p className="text-muted-foreground">
              Real-time miner health and system alerts
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchOverview()
              refetchAlerts()
            }}
            disabled={overviewLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${overviewLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Miners"
            value={overviewLoading ? '…' : (overviewData?.total_miners ?? 0).toString()}
            icon={<Activity className="h-5 w-5" />}
            subtitle={`${overviewData?.active_miners ?? 0} active`}
          />
          <MetricCard
            title="Active Alerts"
            value={overviewLoading ? '…' : (overviewData?.total_alerts ?? 0).toString()}
            icon={<AlertCircle className="h-5 w-5" />}
            subtitle={`${criticalCount} critical, ${warningCount} warning`}
            trend={criticalCount > 0 ? 'down' : 'up'}
          />
          <MetricCard
            title="Avg Health Score"
            value={overviewLoading ? '…' : (overviewData?.avg_system_health_score ?? 0).toFixed(1)}
            icon={<CheckCircle2 className="h-5 w-5" />}
            subtitle="System-wide average"
            format="number"
          />
          <MetricCard
            title="Subnets"
            value={overviewLoading ? '…' : (overviewData?.total_subnets ?? 0).toString()}
            icon={<Cpu className="h-5 w-5" />}
            subtitle={`${overviewData?.active_subnets ?? 0} active`}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Thermometer className="h-5 w-5" />
                  GPU Utilization Trend
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
                <CardTitle>System Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Down Miners</p>
                    <p className="text-2xl font-bold tabular-nums">{overviewData?.down_miners ?? 0}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Inactive Miners</p>
                    <p className="text-2xl font-bold tabular-nums">{overviewData?.inactive_miners ?? 0}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Emission (24h)</p>
                    <p className="text-2xl font-bold tabular-nums">{(overviewData?.total_emission_24h ?? 0).toFixed(4)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Incentive (24h)</p>
                    <p className="text-2xl font-bold tabular-nums">{(overviewData?.total_incentive_24h ?? 0).toFixed(4)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Active Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {overviewLoading ? (
                  <div className="space-y-3">
                    <div className="h-12 animate-pulse rounded bg-muted" />
                    <div className="h-12 animate-pulse rounded bg-muted" />
                    <div className="h-12 animate-pulse rounded bg-muted" />
                  </div>
                ) : activeAlerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mb-2 text-success" />
                    <p className="text-sm font-medium">All systems healthy</p>
                    <p className="text-xs">No active alerts</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto">
                    {activeAlerts.map((alert) => (
                      <AlertItem key={alert.id} alert={alert} onResolve={handleResolve} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Alert Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Critical</span>
                    <Badge variant="destructive">{overviewData?.critical_alerts ?? 0}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Warning</span>
                    <Badge variant="outline" className="border-warning text-warning">{overviewData?.warning_alerts ?? 0}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Info</span>
                    <Badge variant="secondary">{overviewData?.info_alerts ?? 0}</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
