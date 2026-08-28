'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/utils'

interface RevenueChartProps {
  data: Array<{
    timestamp: string
    value: number
    [key: string]: string | number
  }>
  className?: string
  height?: number
  color?: string
  showLegend?: boolean
  showGrid?: boolean
  showTooltip?: boolean
}

export function RevenueChart({
  data,
  className,
  height = 300,
  color = 'hsl(var(--primary))',
  showLegend = false,
  showGrid = true,
  showTooltip = true,
}: RevenueChartProps) {
  if (!data.length) {
    return (
      <div className={cn('flex items-center justify-center h-[300px]', className)}>
        <p className="text-muted-foreground">No data available</p>
      </div>
    )
  }

  const formattedData = data.map((item) => ({
    ...item,
    name: new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) => {
    if (!active || !payload?.length) return null

    return (
      <div className="rounded-lg border bg-popover p-3 shadow-lg">
        <p className="font-medium">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm">
            <span className="font-medium">{entry.name}: </span>
            {formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />}
          <XAxis
            dataKey="name"
            className="text-xs"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            className="text-xs"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(value) => formatCurrency(value)}
            width={80}
          />
          {showTooltip && <Tooltip content={<CustomTooltip />} />}
          {showLegend && <Legend />}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            fillOpacity={0.1}
            strokeWidth={2}
            fill={`url(${color})`}
          >
            <defs>
              <linearGradient id={`${color.replace(/[^a-zA-Z]/g, '')}-gradient`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

interface MultiRevenueChartProps {
  data: Array<{
    timestamp: string
    [key: string]: string | number
  }>
  keys: string[]
  colors: string[]
  className?: string
  height?: number
  showLegend?: boolean
}

export function MultiRevenueChart({
  data,
  keys,
  colors,
  className,
  height = 300,
  showLegend = true,
}: MultiRevenueChartProps) {
  if (!data.length) {
    return (
      <div className={cn('flex items-center justify-center h-[300px]', className)}>
        <p className="text-muted-foreground">No data available</p>
      </div>
    )
  }

  const formattedData = data.map((item) => ({
    ...item,
    name: new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) => {
    if (!active || !payload?.length) return null

    return (
      <div className="rounded-lg border bg-popover p-3 shadow-lg">
        <p className="font-medium">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="font-medium">{entry.name}: </span>
            {formatCurrency(entry.value)}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={formattedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted/50" vertical={false} />
          <XAxis
            dataKey="name"
            className="text-xs"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
          />
          <YAxis
            className="text-xs"
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            tickFormatter={(value) => formatCurrency(value)}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          {showLegend && <Legend />}
          {keys.map((key, index) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={colors[index]}
              fillOpacity={0.1}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}