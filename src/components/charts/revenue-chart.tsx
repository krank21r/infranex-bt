"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/utils";
import type { RevenuePoint } from "@/lib/infranex/types";

interface RevenueChartProps {
  data: RevenuePoint[];
  height?: number;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover p-3 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="mt-1 flex items-center gap-2 text-sm">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="font-medium">{entry.name}: </span>
          <span className="tabular">
            {entry.name === "TAO"
              ? `${entry.value.toFixed(2)} TAO`
              : formatCurrency(entry.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function RevenueChart({ data, height = 280 }: RevenueChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revUsd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="revTao" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="hsl(var(--border))"
          vertical={false}
          opacity={0.4}
        />
        <XAxis
          dataKey="day"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval={Math.floor(data.length / 6)}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatCurrency(v).replace("$", "$")}
          width={48}
        />
        <Tooltip content={<ChartTooltip />} />
        <Area
          type="monotone"
          dataKey="usd"
          name="USD"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fill="url(#revUsd)"
        />
        <Area
          type="monotone"
          dataKey="tao"
          name="TAO"
          stroke="hsl(var(--chart-2))"
          strokeWidth={1.5}
          fill="url(#revTao)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
