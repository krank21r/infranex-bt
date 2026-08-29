'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, ArrowRight, CheckCircle, Info, AlertOctagon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SubnetChange } from '@/hooks/useChangeDetection'

const IMPACT_STYLES: Record<string, { bg: string; text: string; icon: React.ComponentType<{ className?: string }> }> = {
  none: { bg: 'bg-gray-100', text: 'text-gray-600', icon: Info },
  low: { bg: 'bg-blue-50', text: 'text-blue-700', icon: Info },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-700', icon: AlertTriangle },
  high: { bg: 'bg-orange-50', text: 'text-orange-700', icon: AlertTriangle },
  critical: { bg: 'bg-red-50', text: 'text-red-700', icon: AlertOctagon },
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  emission_shift: 'Emission Shift',
  incentive_shift: 'Incentive Shift',
  stake_shift: 'Stake Shift',
  requirement_change: 'Requirement Change',
  market_shift: 'Market Shift',
  registration_change: 'Registration Change',
  concentration_shift: 'Concentration Shift',
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') {
    if (value > 1000000) return `${(value / 1000000).toFixed(2)}M`
    if (value > 1000) return `${(value / 1000).toFixed(2)}K`
    if (value < 0.01) return value.toExponential(2)
    return value.toFixed(4)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

export function ChangesCard({ changes }: { changes: SubnetChange[] }) {
  if (!changes || changes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Changes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span>No significant changes detected</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  const sorted = [...changes].sort(
    (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent Changes</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sorted.slice(0, 10).map((change) => {
            const style = IMPACT_STYLES[change.impact] ?? IMPACT_STYLES.none
            const Icon = style.icon
            return (
              <div
                key={change.id}
                className={cn('p-3 rounded-lg border', style.bg)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={cn('h-4 w-4 shrink-0', style.text)} />
                    <span className="text-sm font-medium truncate">
                      {CHANGE_TYPE_LABELS[change.change_type] ?? change.change_type}
                    </span>
                  </div>
                  <Badge
                    variant={change.impact === 'critical' ? 'destructive' : 'outline'}
                    className="text-xs shrink-0 capitalize"
                  >
                    {change.impact}
                  </Badge>
                </div>
                {change.notes && (
                  <p className="text-xs text-muted-foreground mt-1 ml-6">
                    {change.notes}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2 ml-6 text-xs text-muted-foreground">
                  <span>{formatValue(change.old_value?.value)}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span>{formatValue(change.new_value?.value)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
