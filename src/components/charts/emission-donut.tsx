"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { EmissionShare } from "@/lib/infranex/types";

interface EmissionDonutProps {
  data: EmissionShare[];
  height?: number;
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: EmissionShare }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const total = payload.length;
  void total;
  return (
    <div className="rounded-lg border bg-popover p-3 shadow-lg">
      <p className="text-sm font-medium">
        {p.name}{" "}
        <span className="mono text-xs text-muted-foreground">{p.symbol}</span>
      </p>
      <p className="mt-0.5 tabular text-xs text-muted-foreground">
        {p.value.toFixed(2)} TAO/block
      </p>
    </div>
  );
}

export function EmissionDonut({ data, height = 260 }: EmissionDonutProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="emission"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={92}
          paddingAngle={2}
          stroke="hsl(var(--background))"
          strokeWidth={2}
        >
          {data.map((entry) => (
            <Cell key={entry.netuid} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip content={<DonutTooltip />} />
      </PieChart>
    </ResponsiveContainer>
  );
}
