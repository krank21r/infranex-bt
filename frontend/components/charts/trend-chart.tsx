'use client'

import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { formatNumber, formatCurrency, formatPercent } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

interface TrendChartProps {
  data: Array<{
    timestamp: string
    value: number
    [key: string]: string | number
  }>
  label: string
  value: number | string
  change?: number
  format?: 'number' | 'currency' | 'tao' | 'percent' | 'raw'
  className?: string
  height?: number
  color?: string
}

export function TrendChart({
  data,
  label,
  value,
  change,
  format = 'number',
  className,
  height = 60,
  color = 'hsl(var(--primary))',
}: TrendChartProps) {
  const formattedValue = 
    format === 'currency' && typeof value === 'number' ? formatCurrency(value) :
    format === 'tao' && typeof value === 'number' ? `${value.toFixed(4)} TAO` :
    format === 'percent' && typeof value === 'number' ? formatPercent(value) :
    format === 'number' && typeof value === 'number' ? formatNumber(value) :
    String(value)

  const changeComponent = change !== undefined && change !== null ? (
    <div className="flex items-center gap-1">
      {change > 0 ? (
        <TrendingUp className="h-3 w-3 text-success" aria-hidden="true" />
      ) : change < 0 ? (
        <TrendingDown className="h-3 w-3 text-destructive" aria-hidden="true" />
      ) : (
        <Minus className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      )}
      <span
        className={cn(
          'text-xs font-medium',
          change > 0 ? 'text-success' : change < 0 ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {formatPercent(Math.abs(change))}
      </span>
    </div>
  ) : null

  const sparklineData = data.slice(-30).map((item, index) => ({
    value: item.value,
    index,
  }))

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground truncate">{label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className="text-xl font-bold tabular-nums">{formattedValue}</p>
            </div>
            {changeComponent}
          </div>
          <div className="relative h-[60px] w-[120px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-transparent" />
                <XAxis
                  type="number"
                  dataKey="index"
                  hide
                />
                <YAxis hide />
                <Tooltip
                  content={({ active, payload }: { active?: boolean; payload?: any[] }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="rounded-lg border bg-popover p-2 shadow-lg">
                        <p className="text-xs font-medium">{formattedValue}</p>
                      </div>
                    )
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface MiniTrendChartProps {
  data: Array<{ value: number }>
  color?: string
  height?: number
  width?: number
  className?: string
}

export function MiniTrendChart({
  data,
  color = 'hsl(var(--primary))',
  height = 40,
  width = 80,
  className,
}: MiniTrendChartProps) {
  const sparklineData = data.map((item, index) => ({
    value: item.value,
    index,
  }))

  return (
    <div className={cn('relative', className)} style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={sparklineData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-transparent" />
          <XAxis type="number" dataKey="index" hide />
          <YAxis hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

interface TrendIndicatorProps {
  value: number
  previousValue: number
  format?: 'number' | 'currency' | 'percent'
  showIcon?: boolean
  className?: string
}

export function TrendIndicator({
  value,
  previousValue,
  format = 'number',
  showIcon = true,
  className,
}: TrendIndicatorProps) {
  const change = previousValue === 0 ? (value > 0 ? 100 : 0) : ((value - previousValue) / Math.abs(previousValue)) * 100
  
  const formattedValue =
    format === 'currency' ? formatCurrency(value) :
    format === 'percent' ? formatPercent(value) :
    formatNumber(value)

  const formattedChange =
    format === 'currency' ? formatCurrency(Math.abs(change)) :
    format === 'percent' ? formatPercent(Math.abs(change)) :
    formatNumber(Math.abs(change))

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <span className="font-medium tabular-nums">{formattedValue}</span>
      {showIcon && (
        <span
          className={cn(
            'inline-flex items-center gap-0.5 text-xs font-medium',
            change > 0 ? 'text-success' : change < 0 ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {change > 0 && <TrendingUp className="h-3 w-3" />}
          {change < 0 && <TrendingDown className="h-3 w-3" />}
          {change === 0 && <Minus className="h-3 w-3" />}
          {change !== 0 && (
            <span>{formattedChange}</span>
          )}
        </span>
      )}
    </div>
  )
}