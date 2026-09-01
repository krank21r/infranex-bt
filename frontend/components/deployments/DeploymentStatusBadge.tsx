'use client'

import { Badge } from '@/components/ui/badge'
import { cn, getStatusColor } from '@/lib/utils'
import type { DeploymentStatus } from '@/types'

interface DeploymentStatusBadgeProps {
  status: DeploymentStatus | string
  withDot?: boolean
  className?: string
}

const labelOverrides: Record<string, string> = {
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
}

export function DeploymentStatusBadge({
  status,
  withDot = true,
  className,
}: DeploymentStatusBadgeProps) {
  const colors = getStatusColor(status)
  const label = labelOverrides[status] ?? status

  return (
    <Badge variant="outline" className={cn('border-0 capitalize', colors.bg, colors.text, className)}>
      {withDot && <span className={cn('h-1.5 w-1.5 rounded-full mr-1.5', colors.dot)} />}
      {label}
    </Badge>
  )
}

export { labelOverrides as deploymentStatusLabels }