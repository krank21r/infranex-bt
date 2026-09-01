'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { MetricCard } from '@/components/cards/metric-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, RefreshCw, Activity, DollarSign, TrendingUp, Coins } from 'lucide-react'
import Link from 'next/link'
import { useDeployment } from '@/hooks/useDeployments'
import { DeploymentStepProgress } from '@/components/deployments/DeploymentStepProgress'
import { getStatusColor } from '@/lib/utils'
import type { Deployment } from '@/types'

interface MinerDetailPageProps {
  params: Promise<{ id: string }>
}

export default function DeploymentDetailPage({ params }: MinerDetailPageProps) {
  const { id } = use(params)
  const router = useRouter()
  const { data: deployment, isLoading, refetch } = useDeployment(id)

  const dep = deployment as Deployment | undefined

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

  if (!dep) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/deployments">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Deployment Not Found</h1>
              <p className="text-muted-foreground">The requested deployment could not be found.</p>
            </div>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  const statusColor = getStatusColor(dep.status)
  const statusLabel = {
    requested: 'Requested',
    approved: 'Approved',
    provisioning: 'Provisioning',
    provisioned: 'Provisioned',
    setup: 'Setting up',
    ready: 'Ready',
    deploying: 'Deploying',
    started: 'Running',
    stopping: 'Stopping',
    stopped: 'Stopped',
    terminated: 'Terminated',
    failed: 'Failed',
  }[dep.status] ?? dep.status

  const stepProgress = dep.steps ? (
    <DeploymentStepProgress
      steps={dep.steps}
      status={dep.status}
    />
  ) : (
    <div className="h-8 bg-muted/50 rounded-md p-2 text-xs text-muted-foreground">No step progress tracked</div>
  )

  const completedSteps = dep.steps?.filter((s) => s.status === 'success').length || 0
  const runningSteps = dep.steps?.filter((s) => s.status === 'running').length || 0

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/deployments">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <Badge className={`${statusColor.bg} ${statusColor.text} border-0 capitalize`}>
                  {statusLabel}
                </Badge>
                <p className="text-muted-foreground font-mono text-xs">
                  {dep.id}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Health Score"
            value={dep.estimated_monthly_revenue != null ? dep.estimated_monthly_revenue.toFixed(2) : '—'}
            icon={<Activity className="h-5 w-5" />}
            subtitle="Est. monthly revenue"
          />
          <MetricCard
            title="Est. Monthly Cost"
            value={dep.estimated_monthly_cost != null ? `${dep.estimated_monthly_cost.toFixed(2)} ${dep.currency || 'USD'}` : '—'}
            icon={<DollarSign className="h-5 w-5" />}
            subtitle="Est. cost"
          />
          <MetricCard
            title="Status"
            value={statusLabel}
            icon={<Badge className={`${statusColor.bg} ${statusColor.text} capitalize`} />}
            subtitle="Current phase"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Deployment Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Deployment ID</div>
                  <div className="font-mono tabular-nums font-medium">{dep.id}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Subnet</div>
                  <div>{dep.subnet_name || `Subnet ${dep.netuid}`}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Provider</div>
                  <div>{dep.provider_name || 'TBD'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">GPU Model</div>
                  <div>{dep.gpu_name || dep.gpu_model_id || 'Not specified'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Hotkey</div>
                  <div>{dep.hotkey_address || 'Not set'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Approved at</div>
                  <div>{dep.approved_at || '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Provisioned at</div>
                  <div>{dep.provisioned_at || '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Started at</div>
                  <div>{dep.started_at || '—'}</div>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Step Progress
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stepProgress}
              <div className="mt-3 pt-3 border-t">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Completed</span>
                  <span className="font-medium">{completedSteps}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Running</span>
                  <span className="font-medium">{runningSteps}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {dep.status === 'requested' || dep.status === 'approved' ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge variant="outline" className="h-6 w-6 rounded-full bg-amber/20 text-amber">
                  L1
                </Badge>
                <span className="font-medium text-sm text-muted-foreground">Approval Required</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                This deployment requires approval before proceeding. Use the approval controls below.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/approvals/${dep.approval_request_id}`)}
                >
                  View Approval
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {!isLoading && dep.steps && dep.steps.length > 0 && (
          <Skeleton className="h-0" aria-hidden="true" />
        )}
      </div>
    </DashboardLayout>
  )
}