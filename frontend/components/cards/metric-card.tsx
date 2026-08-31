'use client'

import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatNumber, formatCurrency, formatPercent } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'

interface MetricCardProps {
  title: string
  value: number | string
  change?: number
  changeLabel?: string
  icon?: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  format?: 'number' | 'currency' | 'tao' | 'percent' | 'raw'
  subtitle?: string
  className?: string
  style?: React.CSSProperties
  loading?: boolean
}

export function MetricCard({
  title,
  value,
  change,
  changeLabel = 'vs last period',
  icon,
  trend,
  format = 'number',
  subtitle,
  className,
  style,
  loading,
}: MetricCardProps) {
  const formattedValue = loading ? (
    <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
  ) : (
    <>
      {format === 'currency' && typeof value === 'number' && formatCurrency(value)}
      {format === 'tao' && typeof value === 'number' && `${value.toFixed(4)} TAO`}
      {format === 'percent' && typeof value === 'number' && formatPercent(value)}
      {format === 'number' && typeof value === 'number' && formatNumber(value)}
      {typeof value === 'string' && value}
    </>
  )

  const changeComponent = change !== undefined && change !== null && !loading ? (
    <div className="flex items-center gap-1 text-xs">
      {change > 0 ? (
        <TrendingUp className="h-3 w-3 text-success" aria-hidden="true" />
      ) : change < 0 ? (
        <TrendingDown className="h-3 w-3 text-destructive" aria-hidden="true" />
      ) : (
        <Minus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      )}
      <span
        className={cn(
          'font-medium',
          change > 0 ? 'text-success' : change < 0 ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {formatPercent(Math.abs(change))}
      </span>
      <span className="text-muted-foreground">{changeLabel}</span>
    </div>
  ) : null

  return (
    <Card
      className={cn('metric-card relative overflow-hidden', className)}
      style={style}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className="text-2xl font-bold tabular-nums">{formattedValue}</p>
              {icon && <span className="text-muted-foreground">{icon}</span>}
            </div>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
            {changeComponent}
          </div>
          {trend && (
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                trend === 'up' && 'bg-success/10 text-success',
                trend === 'down' && 'bg-destructive/10 text-destructive',
                trend === 'neutral' && 'bg-muted text-muted-foreground'
              )}
              aria-label={`Trend: ${trend}`}
            >
              {trend === 'up' && <TrendingUp className="h-4 w-4" />}
              {trend === 'down' && <TrendingDown className="h-4 w-4" />}
              {trend === 'neutral' && <Minus className="h-4 w-4" />}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}