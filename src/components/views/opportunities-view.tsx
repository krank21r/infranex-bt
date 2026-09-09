"use client";

import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OpportunityTable } from "@/components/tables/opportunity-table";
import { OpportunityCard } from "@/components/cards/opportunity-detail";
import { useNetwork, mergeOpportunities } from "@/lib/infranex/use-network";
import { cn, scoreBand } from "@/lib/utils";
import { TrendingUp, LayoutGrid, List, Cpu } from "lucide-react";
import type { Opportunity } from "@/lib/infranex/types";

interface OpportunitiesViewProps {
  onSelectOpportunity: (o: Opportunity) => void;
  onStartMining?: (o: Opportunity) => void;
}

const GPU_FILTER_KEY = "infranex-gpu-filter";

// "What can my rig run?" — subnets whose required VRAM fits the selected GPU.
// CPU-only shows subnets whose work type needs no GPU at all.
const GPU_FILTERS: { value: string; label: string; maxVram: number | null }[] = [
  { value: "any", label: "Any hardware", maxVram: null },
  { value: "cpu", label: "CPU-only work", maxVram: 0 },
  { value: "8", label: "8 GB+ (entry)", maxVram: 8 },
  { value: "16", label: "16 GB+ (4060 Ti)", maxVram: 16 },
  { value: "24", label: "24 GB+ (4090)", maxVram: 24 },
  { value: "48", label: "48 GB+ (A6000)", maxVram: 48 },
  { value: "80", label: "80 GB+ (A100/H100)", maxVram: 80 },
  { value: "141", label: "141 GB+ (H200)", maxVram: 141 },
];

export function OpportunitiesView({ onSelectOpportunity, onStartMining }: OpportunitiesViewProps) {
  const [layout, setLayout] = useState<"table" | "grid">("table");
  const [filter, setFilter] = useState<"all" | "RUN" | "WATCH" | "AVOID">("all");
  const [gpuFilter, setGpuFilter] = useState("any");
  const [gpuDirty, setGpuDirty] = useState(false);
  const { data: snap } = useNetwork();
  const opportunities = mergeOpportunities(snap);

  // Restore the miner's hardware profile across visits. Deferred past the
  // hydration pass so SSR markup stays deterministic.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(GPU_FILTER_KEY); } catch { /* ignore */ }
    if (!saved) return;
    const t = setTimeout(() => setGpuFilter(saved!), 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!gpuDirty) return;
    try { localStorage.setItem(GPU_FILTER_KEY, gpuFilter); } catch { /* ignore */ }
  }, [gpuFilter, gpuDirty]);

  const applyGpuFilter = (v: string) => {
    setGpuFilter(v);
    setGpuDirty(true);
  };

  const filtered = useMemo(() => {
    let r = opportunities;
    const gf = GPU_FILTERS.find((g) => g.value === gpuFilter);
    if (gf) {
      if (gf.maxVram === 0) r = r.filter((o) => o.minVramGb <= 0);
      else if (gf.maxVram != null) r = r.filter((o) => o.minVramGb <= gf.maxVram!);
    }
    if (filter !== "all") r = r.filter((o) => scoreBand(o.score).label === filter);
    return r;
  }, [filter, gpuFilter, opportunities]);

  const tabs: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: filtered.length },
    { key: "RUN", label: "RUN", count: filtered.filter((o) => scoreBand(o.score).label === "RUN").length },
    { key: "WATCH", label: "WATCH", count: filtered.filter((o) => scoreBand(o.score).label === "WATCH").length },
    { key: "AVOID", label: "AVOID", count: filtered.filter((o) => scoreBand(o.score).label === "AVOID").length },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">Section · 02</p>
          <h1 className="animate-rise text-display text-3xl font-bold tracking-tight md:text-4xl">
            Opportunities
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All 129 Finney subnets scored with the Miner&apos;s Ledger — per-<span className="text-foreground/80">earning</span>-miner
            revenue minus GPU + infra cost, seat safety (slot pressure, reward
            concentration, burn, immunity), alpha economics (24h trend,
            liquidity, slippage) and earning reality.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-card/40 p-1">
          <Button
            variant={layout === "table" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setLayout("table")}
            className="gap-1.5"
          >
            <List className="h-3.5 w-3.5" />
            Table
          </Button>
          <Button
            variant={layout === "grid" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setLayout("grid")}
            className="gap-1.5"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Grid
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === t.key
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/60 bg-card/30 text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            <Badge variant="outline" className="mono text-[10px]">
              {t.count}
            </Badge>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={gpuFilter} onValueChange={applyGpuFilter}>
            <SelectTrigger className="h-8 w-[190px] rounded-full border-border/60 bg-card/30 text-xs">
              <SelectValue placeholder="My GPU" />
            </SelectTrigger>
            <SelectContent>
              {GPU_FILTERS.map((g) => (
                <SelectItem key={g.value} value={g.value} className="text-xs">
                  {g.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-display flex items-center gap-2 text-xl">
            <TrendingUp className="h-4 w-4 text-primary" />
            Ranked opportunities
            <span className="text-xs font-normal text-muted-foreground">
              ranked by net ROI, seat safety & alpha hold value
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {layout === "table" ? (
            <OpportunityTable
              opportunities={filtered}
              onSelect={onSelectOpportunity}
              onStartMining={onStartMining}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((o) => (
                <OpportunityCard key={o.id} opportunity={o} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
