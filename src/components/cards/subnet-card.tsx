"use client";

import { cn, formatNumber, formatCurrency, getStatusColor } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Users, Shield, Cpu, TrendingUp, TrendingDown } from "lucide-react";
import type { Subnet } from "@/lib/infranex/types";

interface SubnetCardProps {
  subnet: Subnet & { live?: unknown };
  score?: number;
  rank?: number;
  onSelect?: (s: Subnet) => void;
}

export function SubnetCard({ subnet: s, score, rank, onSelect }: SubnetCardProps) {
  const status = getStatusColor(s.status);
  const up = s.change24h >= 0;
  const util = Math.min(100, (s.minersCount / s.maxNeurons) * 100);

  return (
    <Card
      className={cn(
        "editorial-card transition-all hover:border-primary/40",
        onSelect && "cursor-pointer"
      )}
      onClick={() => onSelect?.(s)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-display truncate text-lg">
                {s.name}
              </CardTitle>
              <Badge variant="outline" className="mono text-[10px]">
                {s.symbol}
              </Badge>
              {s.live && (
                <Badge variant="outline" className="border-success/30 text-[10px] text-success">
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success" />
                  live
                </Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {s.description}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {rank !== undefined && (
              <p className="mono text-[10px] uppercase tracking-wider text-muted-foreground">
                rank {String(rank).padStart(2, "0")}
              </p>
            )}
            {score !== undefined && (
              <p className="tabular text-xl font-bold text-primary">
                {score.toFixed(1)}
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {s.category}
          </Badge>
          <span className={cn("badge-status", status.bg, status.text)}>
            {s.status}
          </span>
          {s.registrationOpen ? (
            <Badge variant="outline" className="border-success/30 text-[10px] text-success">
              registration open
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              registration closed
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <p className="text-[10px] text-muted-foreground">Miners</p>
              <p className="tabular font-medium">{formatNumber(s.minersCount)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <p className="text-[10px] text-muted-foreground">Validators</p>
              <p className="tabular font-medium">{s.validatorsCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
            <div>
              <p className="text-[10px] text-muted-foreground">Min VRAM</p>
              <p className="mono tabular font-medium">{s.minVramGb} GB</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {up ? (
              <TrendingUp className="h-3.5 w-3.5 text-success" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-destructive" />
            )}
            <div>
              <p className="text-[10px] text-muted-foreground">24h</p>
              <p
                className={cn(
                  "tabular font-medium",
                  up ? "text-success" : "text-destructive"
                )}
              >
                {up ? "+" : ""}
                {s.change24h.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Capacity</span>
            <span className="tabular">{util.toFixed(0)}% full</span>
          </div>
          <Progress
            value={util}
            className="mt-1 h-1"
            indicatorClassName={cn(util > 85 ? "bg-warning" : "bg-primary")}
          />
        </div>

        <div className="flex items-center justify-between border-t pt-2 text-xs">
          <span className="text-muted-foreground">Emission</span>
          <span className="mono tabular font-medium text-primary">
            {s.emission.toFixed(2)} TAO/blk
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Market cap</span>
          <span className="tabular font-medium">
            {formatCurrency(s.marketCap)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
