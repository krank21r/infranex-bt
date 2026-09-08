"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OpportunityTable } from "@/components/tables/opportunity-table";
import { OpportunityCard } from "@/components/cards/opportunity-detail";
import { opportunities as curatedOpportunities } from "@/lib/infranex/data";
import { useNetwork, mergeOpportunities } from "@/lib/infranex/use-network";
import { cn, scoreBand } from "@/lib/utils";
import { TrendingUp, LayoutGrid, List } from "lucide-react";
import type { Opportunity } from "@/lib/infranex/types";

interface OpportunitiesViewProps {
  onSelectOpportunity: (o: Opportunity) => void;
}

export function OpportunitiesView({ onSelectOpportunity }: OpportunitiesViewProps) {
  const [layout, setLayout] = useState<"table" | "grid">("table");
  const [filter, setFilter] = useState<"all" | "RUN" | "WATCH" | "AVOID">("all");
  const { data: snap } = useNetwork();
  const opportunities = mergeOpportunities(snap);

  const filtered = useMemo(() => {
    if (filter === "all") return opportunities;
    return opportunities.filter((o) => scoreBand(o.score).label === filter);
  }, [filter, opportunities]);

  const tabs: { key: typeof filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: opportunities.length },
    { key: "RUN", label: "RUN", count: opportunities.filter((o) => scoreBand(o.score).label === "RUN").length },
    { key: "WATCH", label: "WATCH", count: opportunities.filter((o) => scoreBand(o.score).label === "WATCH").length },
    { key: "AVOID", label: "AVOID", count: opportunities.filter((o) => scoreBand(o.score).label === "AVOID").length },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">Section · 02</p>
          <h1 className="text-display text-3xl font-bold tracking-tight md:text-4xl">
            Opportunities
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ranked mining opportunities across every tracked subnet, scored on
            the 3-pillar model (Utility 30% · Technical 35% · Economics 35%).
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
      </div>

      <Card className="border-border/60 bg-card/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-display flex items-center gap-2 text-xl">
            <TrendingUp className="h-4 w-4 text-primary" />
            Ranked opportunities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {layout === "table" ? (
            <OpportunityTable
              opportunities={filtered}
              onSelect={onSelectOpportunity}
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
