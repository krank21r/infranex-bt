"use client";

import { useState, useMemo } from "react";
import { cn, formatCurrency, formatPercent, getStatusColor, scoreBand } from "@/lib/utils";
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, MoreHorizontal, Zap } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Opportunity } from "@/lib/infranex/types";

interface OpportunityTableProps {
  opportunities: Opportunity[];
  onSelect?: (o: Opportunity) => void;
  onStartMining?: (o: Opportunity) => void;
  className?: string;
  compact?: boolean;
}

type SortKey =
  | "rank"
  | "subnetName"
  | "score"
  | "estimatedApy"
  | "estimatedMonthlyRewardUsd"
  | "requiredStake"
  | "utilization"
  | "riskLevel"
  | "confidence"
  | "minVramGb";

function SortIcon({
  k,
  sortKey,
  dir,
}: {
  k: SortKey;
  sortKey: SortKey;
  dir: "asc" | "desc";
}) {
  if (sortKey !== k)
    return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
  return dir === "asc" ? (
    <ChevronUp className="h-3.5 w-3.5" />
  ) : (
    <ChevronDown className="h-3.5 w-3.5" />
  );
}

function SortableTh({
  k,
  children,
  align = "left",
  sortKey,
  dir,
  onSort,
}: {
  k: SortKey;
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  sortKey: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  return (
    <TableHead
      className={align === "right" ? "text-right" : align === "center" ? "text-center" : ""}
    >
      <button
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 select-none hover:text-foreground transition-colors",
          align === "right" && "flex-row-reverse"
        )}
      >
        {children}
        <SortIcon k={k} sortKey={sortKey} dir={dir} />
      </button>
    </TableHead>
  );
}

export function OpportunityTable({
  opportunities,
  onSelect,
  onStartMining,
  className,
  compact = false,
}: OpportunityTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let r = opportunities;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (o) =>
          o.subnetName.toLowerCase().includes(q) ||
          o.subnetSymbol.toLowerCase().includes(q) ||
          String(o.netuid).includes(q) ||
          o.category.toLowerCase().includes(q)
      );
    }
    const sorted = [...r].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return dir === "asc" ? av - bv : bv - av;
      }
      return dir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return sorted;
  }, [opportunities, sortKey, dir, search]);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setDir(k === "rank" ? "asc" : "desc");
    }
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search subnets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-lg border-border/60 bg-card/50 pl-9 focus:border-primary/40"
            aria-label="Search opportunities"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="tabular text-foreground/80">{filtered.length}</span> of{" "}
          <span className="tabular">{opportunities.length}</span> opportunities
        </p>
      </div>

      <div className="table-container">
        <Table>
          <TableHeader>
            <TableRow className="table-header hover:bg-transparent">
              <SortableTh k="rank" sortKey={sortKey} dir={dir} onSort={handleSort}>
                #
              </SortableTh>
              <SortableTh k="subnetName" sortKey={sortKey} dir={dir} onSort={handleSort}>
                Subnet
              </SortableTh>
              {!compact && (
                <SortableTh k="score" sortKey={sortKey} dir={dir} onSort={handleSort}>
                  Score
                </SortableTh>
              )}
              {!compact && (
                <SortableTh
                  k="estimatedApy"
                  align="right"
                  sortKey={sortKey}
                  dir={dir}
                  onSort={handleSort}
                >
                  Est. APY
                </SortableTh>
              )}
              <SortableTh
                k="estimatedMonthlyRewardUsd"
                align="right"
                sortKey={sortKey}
                dir={dir}
                onSort={handleSort}
              >
                Monthly
              </SortableTh>
              {!compact && (
                <SortableTh
                  k="requiredStake"
                  align="right"
                  sortKey={sortKey}
                  dir={dir}
                  onSort={handleSort}
                >
                  Stake
                </SortableTh>
              )}
              {!compact && (
                <SortableTh
                  k="utilization"
                  align="right"
                  sortKey={sortKey}
                  dir={dir}
                  onSort={handleSort}
                >
                  Util.
                </SortableTh>
              )}
              {!compact && (
                <SortableTh
                  k="minVramGb"
                  align="right"
                  sortKey={sortKey}
                  dir={dir}
                  onSort={handleSort}
                >
                  GPU Req.
                </SortableTh>
              )}
              {!compact && (
                <SortableTh k="riskLevel" sortKey={sortKey} dir={dir} onSort={handleSort}>
                  Risk
                </SortableTh>
              )}
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={compact ? 4 : 10}
                  className="py-12 text-center text-muted-foreground"
                >
                  No opportunities match your search.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((o) => {
                const band = scoreBand(o.score);
                const risk = getStatusColor(o.riskLevel);
                return (
                  <TableRow
                    key={o.id}
                    onClick={() => onSelect?.(o)}
                    className={cn(onSelect && "cursor-pointer")}
                  >
                    <TableCell className="mono tabular text-muted-foreground">
                      {String(o.rank).padStart(2, "0")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">
                              {o.subnetName}
                            </span>
                            <Badge variant="outline" className="mono text-[10px]">
                              {o.subnetSymbol}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            NetUID {o.netuid} · {o.category}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    {!compact && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="tabular font-semibold">
                            {o.score.toFixed(1)}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn("text-[10px]", band.bg, band.color)}
                          >
                            {band.label}
                          </Badge>
                        </div>
                      </TableCell>
                    )}
                    {!compact && (
                      <TableCell className="text-right tabular font-medium text-success">
                        {formatPercent(o.estimatedApy)}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular font-medium">
                      {formatCurrency(o.estimatedMonthlyRewardUsd)}
                    </TableCell>
                    {!compact && (
                      <TableCell className="text-right mono tabular text-muted-foreground">
                        {o.requiredStake.toLocaleString()} TAO
                      </TableCell>
                    )}
                    {!compact && (
                      <TableCell className="text-right tabular">
                        <span
                          className={cn(
                            o.utilization > 0.8
                              ? "text-warning"
                              : "text-muted-foreground"
                          )}
                        >
                          {(o.utilization * 100).toFixed(0)}%
                        </span>
                      </TableCell>
                    )}
                    {!compact && (
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span
                            className={cn(
                              "mono tabular font-medium",
                              o.minVramGb >= 80
                                ? "text-primary"
                                : o.minVramGb >= 40
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                            )}
                          >
                            {o.minVramGb} GB
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {o.recommendedGpu.replace("NVIDIA ", "").replace(" 80GB", "").replace(" 40GB", "")}
                          </span>
                        </div>
                      </TableCell>
                    )}
                    {!compact && (
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("capitalize", risk.bg, risk.text)}
                        >
                          {o.riskLevel}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onSelect?.(o)}>
                            View breakdown
                          </DropdownMenuItem>
                          {onStartMining && (
                            <DropdownMenuItem
                              onClick={() => onStartMining(o)}
                              className="gap-2 text-primary focus:text-primary"
                            >
                              <Zap className="h-3.5 w-3.5" />
                              Start mining (needs {o.minVramGb}GB)
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem>Recommend GPU</DropdownMenuItem>
                          <DropdownMenuItem>Register miner</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
