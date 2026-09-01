'use client'

import { useMemo } from 'react'
import { Check, Loader2, X, Circle, SkipForward } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import type { DeploymentStep, DeploymentStatus, DeploymentStepStatus } from '@/types'

interface DeploymentStepProgressProps {
  status?: DeploymentStatus | string
  steps?: DeploymentStep[]
  className?: string
}

const DEFAULT_PIPELINE: Array<{ name: string; label: string; fromState: string; toState: string }> = [
  { name: 'request', label: 'Requested', fromState: '__start__', toState: 'requested' },
  { name: 'approve', label: 'Approved', fromState: 'requested', toState: 'approved' },
  { name: 'provision', label: 'Provisioned', fromState: 'approved', toState: 'provisioned' },
  { name: 'setup', label: 'Ready', fromState: 'provisioned', toState: 'ready' },
  { name: 'deploy', label: 'Deployed', fromState: 'ready', toState: 'deploying' },
  { name: 'health_check', label: 'Running', fromState: 'deploying', toState: 'started' },
]

const STATE_ORDER = [
  'requested',
  'approved',
  'provisioning',
  'provisioned',
  'setup',
  'ready',
  'deploying',
  'started',
  'stopping',
  'stopped',
  'terminated',
  'failed',
]

function statusForStep(stepName: string, current: string): DeploymentStepStatus {
  const stepIdx = DEFAULT_PIPELINE.findIndex((s) => s.name === stepName)
  if (stepIdx === -1) return 'pending'
  const stepState = DEFAULT_PIPELINE[stepIdx].toState
  const curIdx = STATE_ORDER.indexOf(current)
  const targetIdx = STATE_ORDER.indexOf(stepState)

  if (current === 'failed') {
    const stoppedIdx = STATE_ORDER.indexOf('stopped')
    return targetIdx <= stoppedIdx ? 'success' : 'failed'
  }
  if (current === 'terminated') return targetIdx <= STATE_ORDER.indexOf('started') ? 'success' : 'skipped'
  if (current === 'stopped') return targetIdx <= STATE_ORDER.indexOf('started') ? 'success' : 'skipped'
  if (curIdx === -1 || targetIdx === -1) return 'pending'
  if (curIdx > targetIdx) return 'success'
  if (curIdx === targetIdx) return 'running'
  return 'pending'
}

function computeProgress(steps: DeploymentStep[] | undefined, status: string): number {
  if (steps && steps.length > 0) {
    const total = steps.length
    const done = steps.filter((s) => s.status === 'success').length
    const running = steps.some((s) => s.status === 'running') ? 1 : 0
    return Math.min(100, Math.round(((done + running * 0.5) / total) * 100))
  }
  const curIdx = STATE_ORDER.indexOf(status)
  if (curIdx === -1) return 0
  const lastSuccess = STATE_ORDER.indexOf('started')
  return Math.min(100, Math.round(((curIdx + 1) / (lastSuccess + 1)) * 100))
}

export function DeploymentStepProgress({
  status = 'requested',
  steps,
  className,
}: DeploymentStepProgressProps) {
  const pipeline = useMemo(() => {
    if (!steps || steps.length === 0) {
      return DEFAULT_PIPELINE.map((p) => ({
        name: p.name,
        label: p.label,
        status: statusForStep(p.name, status),
      }))
    }
    return [...steps]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        name: s.name,
        label: s.label,
        status: s.status,
      }))
  }, [steps, status])

  const progress = computeProgress(steps, status)

  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Pipeline progress</span>
          <span className="font-mono tabular-nums">{progress}%</span>
        </div>
        <Progress value={progress} />
      </div>

      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pipeline.map((step, idx) => (
          <li
            key={`${step.name}-${idx}`}
            className={cn(
              'flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm transition-colors',
              step.status === 'success' && 'border-success/30 bg-success/5',
              step.status === 'failed' && 'border-destructive/30 bg-destructive/5',
              step.status === 'running' && 'border-primary/40 bg-primary/5',
              step.status === 'pending' && 'border-border'
            )}
          >
            <StepIcon status={step.status} />
            <div className="flex flex-col min-w-0">
              <span className="font-medium truncate">{step.label}</span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {step.status}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function StepIcon({ status }: { status: DeploymentStepStatus }) {
  if (status === 'success') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="h-3.5 w-3.5" />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive/15 text-destructive">
        <X className="h-3.5 w-3.5" />
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SkipForward className="h-3.5 w-3.5" />
      </span>
    )
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Circle className="h-3 w-3" />
    </span>
  )
}