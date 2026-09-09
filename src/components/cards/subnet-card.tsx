"use client";

import { cn, formatNumber, formatCurrency, getStatusColor } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Users, Shield, Cpu, TrendingUp, TrendingDown, Settings2, FileText } from "lucide-react";
import type { Subnet } from "@/lib/infranex/types";

interface SubnetCardProps {
  subnet: Subnet & {
    live?: unknown;
    liveFields?: Set<string>;
    overriddenFields?: Set<string>;
  };
  score?: number;
  rank?: number;
  onSelect?: (s: Subnet) => void;
  onEdit?: (s: Subnet) => void;
  onViewRequirements?: (s: Subnet) => void;
}

function FieldBadge({
  field,
  liveFields,
  overriddenFields,
  children,
}: {
  field: string;
  liveFields?: Set<string>;
  overriddenFields?: Set<string>;
  children: React.ReactNode;
}) {
  if (overriddenFields?.has(field)) {
    return (
      <span className="inline-flex items-center gap-1">
        {children}
        <span className="h-1 w-1 rounded-full bg-warning" title="User override" />
      </span>
    );
  }
  if (liveFields?.has(field)) {
    return (
      <span className="inline-flex items-center gap-1">
        {children}
        <span className="h-1 w-1 rounded-full bg-success" title="Live from chain" />
      </span>
    );
  }
  return <span>{children}</span>;
}

export function SubnetCard({ subnet: s, score, rank, onSelect, onEdit, onViewRequirements }: SubnetCardProps) {
  const status = getStatusColor(s.status);
  const up = s.change24h >= 0;
  const util = Math.min(100, (s.minersCount / s.maxNeurons) * 100);
  const liveFields = s.liveFields;
  const overriddenFields = s.overriddenFields;

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
                <FieldBadge field="name" liveFields={liveFields} overriddenFields={overriddenFields}>{s.name}</FieldBadge>
              </CardTitle>
              <Badge variant="outline" className="mono text-[10px]">
                {s.symbol}
              </Badge>
              {s.live ? (
                <Badge variant="outline" className="border-success/30 text-[10px] text-success">
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success" />
                  live
                </Badge>
              ) : null}
              {overriddenFields && overriddenFields.size > 0 && (
                <Badge variant="outline" className="border-warning/30 text-[10px] text-warning">
                  <Settings2 className="mr-0.5 h-2.5 w-2.5" />
                  edited
                </Badge>
              )}
            </div>
            <p
              className="mt-1 text-xs text-muted-foreground"
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {s.description.replace(/^[-=*_\s]+/, "").replace(/\s+/g, " ")}
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
            <div className="mt-1 flex items-center gap-0.5">
              {onViewRequirements && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[10px] text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewRequirements(s);
                  }}
                >
                  <FileText className="h-3 w-3" />
                  Requirements
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(s);
                  }}
                  aria-label="Edit metadata"
                >
                  <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            <FieldBadge field="category" liveFields={liveFields} overriddenFields={overriddenFields}>{s.category}</FieldBadge>
          </Badge>
          <span className={cn("badge-status", status.bg, status.text)}>
            <FieldBadge field="status" liveFields={liveFields} overriddenFields={overriddenFields}>{s.status}</FieldBadge>
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
              <FieldBadge field="minersCount" liveFields={liveFields} overriddenFields={overriddenFields}>
                <p className="tabular font-medium">{formatNumber(s.minersCount)}</p>
              </FieldBadge>
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
              <FieldBadge field="minVramGb" liveFields={liveFields} overriddenFields={overriddenFields}>
                <p className="mono tabular font-medium">{s.minVramGb} GB</p>
              </FieldBadge>
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
              <p className={cn("tabular font-medium", up ? "text-success" : "text-destructive")}>
                {up ? "+" : ""}{s.change24h.toFixed(1)}%
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
          <FieldBadge field="emission" liveFields={liveFields} overriddenFields={overriddenFields}>
            <span className="mono tabular font-medium text-primary">
              {s.emission.toFixed(2)} TAO/blk
            </span>
          </FieldBadge>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Market cap</span>
          <FieldBadge field="marketCap" liveFields={liveFields} overriddenFields={overriddenFields}>
            <span className="tabular font-medium">{formatCurrency(s.marketCap)}</span>
          </FieldBadge>
        </div>
      </CardContent>
    </Card>
  );
}
