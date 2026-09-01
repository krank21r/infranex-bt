'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Coins, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DeploymentStatusBadge } from '@/components/deployments/DeploymentStatusBadge'
import { DeploymentStepProgress } from '@/components/deployments/DeploymentStepProgress'
import type { Deployment, DeploymentServer, DeploymentStatus } from '@/types'

export type MinerAction = 'view' | 'start' | 'stop' | 'migrate' | 'delete' | 'approve' | 'provision' | 'terminate' | 'tick' | 'deploy'

interface DeploymentCardProps {
  deployment: Deployment
  server?: DeploymentServer
  onAction: (action: MinerAction, deployment: Deployment) => void
  busy?: boolean
}

function StatusColorClass(status: DeploymentStatus | string) {
  const overrides: Record<string, string> = {
    requested: 'bg-primary/10 text-primary',
    approved: 'bg-success/10 text-success',
    provisioning: 'bg-primary/10 text-primary',
    provisioned: 'bg-success/10 text-success',
    setup: 'bg-warning/10 text-warning',
    ready: 'bg-success/10 text-success',
    deploying: 'bg-primary/10 text-primary',
    started: 'bg-success/10 text-success',
    stopping: 'bg-warning/10 text-warning',
    stopped: 'bg-muted/50 text-muted-foreground',
    terminated: 'bg-muted/50 text-muted-foreground',
    failed: 'bg-destructive/10 text-destructive',
  }
  return overrides[status] || 'bg-muted/50 text-muted-foreground'
}

interface DeploymentCardProps {
  deployment: Deployment
  server?: DeploymentServer
  onAction: (action: MinerAction, deployment: Deployment) => void
  busy?: boolean
}

export function DeploymentCard({ deployment, server, onAction, busy }: DeploymentCardProps) {
  const statusColor = cn(
    StatusColorClass(deployment.status),
    'transition-colors hover:bg-muted/30'
  )

  const steps = deployment.steps || []
  const hasApprovalRequest = !!deployment.approval_request_id

  return (
    <Card className={statusColor}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="h-5 w-5" />
          <span className="font-medium truncate">{deployment.subnet_name || `Subnet ${deployment.netuid}`}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Status</span>
          <DeploymentStatusBadge status={deployment.status} withDot={false} className="capitalize" />
        </div>

        {hasApprovalRequest && (
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="outline" className="h-6 w-6 rounded-full bg-amber/20 text-amber">
              {deployment.approval_request_id || '—'}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Approval pending{' '}
              <Badge variant="outline" className="h-3 w-3 rounded-full bg-amber/30 text-amber/60 animate-pulse">
                pending
              </Badge>
            </span>
          </div>
        )}

        {steps.length > 0 ? (
          <DeploymentStepProgress steps={steps} status={deployment.status} />
        ) : (
          <p className="text-xs text-muted-foreground">No step progress tracked</p>
        )}

        <div className="grid grid-cols-2 gap-3 pt-3 border-t">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Subnet</p>
            <p className="font-medium truncate">{deployment.subnet_name || `Subnet ${deployment.netuid}`}</p>
            <p>netuid {deployment.netuid}</p>
          </div>

          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Provider</p>
            <p className="font-medium">{server?.name || 'TBD'}</p>
            <p className="text-xs">{server?.region || ''}</p>
          </div>
        </div>

        {server && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs text-muted-foreground">Server</p>
            <p className="font-medium text-sm">{server.ip_address || 'Not provisioned'}</p>
            <p className="text-xs">{server.ssh_port || ''} / {server.vram_gb?.toFixed(0) ?? '—'} GB VRAM</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            asChild
            onClick={() => onAction('view', deployment)}
            disabled={busy}
          >
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> View
          </Button>
          {deployment.status === 'requested' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction('approve', deployment)}
                disabled={busy}
              >
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction('provision', deployment)}
                disabled={busy}
              >
                Provision
              </Button>
            </>
          ) : deployment.status === 'approved' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction('deploy', deployment)}
                disabled={busy}
              >
                Deploy
              </Button>
            </>
          ) : deployment.status === 'started' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction('stop', deployment)}
                disabled={busy}
              >
                Stop
              </Button>
            </>
          ) : (
            <>
              {deployment.status !== 'terminated' && deployment.status !== 'failed' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onAction('terminate', deployment)}
                  disabled={busy}
                >
                  Terminate
                </Button>
              ) : null}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}