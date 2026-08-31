'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, XCircle, AlertTriangle, Activity } from 'lucide-react'
import type { WorkerMetrics } from '@/hooks/useChangeDetection'

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'Never'
  const date = new Date(ts * 1000)
  const now = Date.now()
  const diff = now - date.getTime()
  if (diff < 60000) return 'Just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return date.toLocaleDateString()
}

export function WorkerStatusCard({ workers }: { workers: WorkerMetrics[] }) {
  if (!workers || workers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-4 w-4" /> System Workers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No worker data available</p>
        </CardContent>
      </Card>
    )
  }

  const healthy = workers.filter((w) => w.is_healthy).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4" /> System Workers
          </span>
          <Badge variant={healthy === workers.length ? 'success' : 'outline'}>
            {healthy}/{workers.length} healthy
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {workers.map((worker) => (
            <div
              key={worker.worker_name}
              className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
            >
              <div className="flex items-center gap-2 min-w-0">
                {worker.is_healthy ? (
                  <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                ) : worker.is_running ? (
                  <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{worker.worker_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {worker.runs_total} runs · {formatTimestamp(worker.last_run_at)}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <Badge
                  variant={worker.is_running ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {worker.is_running ? 'Running' : 'Stopped'}
                </Badge>
                {worker.runs_failed > 0 && (
                  <p className="text-xs text-destructive mt-1">
                    {worker.runs_failed} failed
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
