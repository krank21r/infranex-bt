"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SubnetCard } from "@/components/cards/subnet-card";
import { SubnetEditDialog } from "@/components/subnets/subnet-edit-dialog";
import { SubnetRequirementsDialog } from "@/components/subnets/subnet-requirements-dialog";
import { subnets as curatedSubnets, opportunities as curatedOpportunities } from "@/lib/infranex/data";
import { useNetwork, mergeSubnets } from "@/lib/infranex/use-network";
import { useSubnetOverrides, useSyncAllSubnets } from "@/lib/infranex/use-subnet-overrides";
import { useToast } from "@/hooks/use-toast";
import { Search, RefreshCw, Network, Info, Github, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Subnet } from "@/lib/infranex/types";

export function SubnetsView() {
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState<"all" | "active" | "open">("all");
  const [editSubnet, setEditSubnet] = useState<Subnet | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [reqSubnet, setReqSubnet] = useState<Subnet | null>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const { data: snap, isFetching, refetch } = useNetwork();
  const { data: overrides } = useSubnetOverrides();
  const syncMut = useSyncAllSubnets();
  const { toast } = useToast();
  const didAutoSync = useRef(false);

  const subnets = mergeSubnets(snap, overrides);

  const scoreByNetuid = useMemo(() => {
    const map = new Map<number, { score: number; rank: number }>();
    curatedOpportunities.forEach((o) => map.set(o.netuid, { score: o.score, rank: o.rank }));
    return map;
  }, []);

  const filtered = useMemo(() => {
    let r = subnets;
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          String(s.netuid).includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (activeOnly === "active") r = r.filter((s) => s.status === "active");
    if (activeOnly === "open") r = r.filter((s) => s.registrationOpen);
    return r;
  }, [search, activeOnly, subnets]);

  const handleEdit = (s: Subnet) => {
    setEditSubnet(s);
    setEditOpen(true);
  };

  const handleViewRequirements = (s: Subnet) => {
    setReqSubnet(s);
    setReqOpen(true);
  };

  const handleSyncAll = async (force: boolean = false) => {
    try {
      const result = await syncMut.mutateAsync(force);
      toast({
        title: "GitHub sync complete",
        description: `${result.scraped} scraped, ${result.skipped} skipped, ${result.errors} errors`,
      });
    } catch (e) {
      toast({
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  // Auto-sync on first load if no overrides exist
  useEffect(() => {
    if (didAutoSync.current) return;
    if (overrides && overrides.size === 0 && !syncMut.isPending) {
      didAutoSync.current = true;
      // Defer to microtask to avoid setState-in-effect
      void Promise.resolve().then(() => handleSyncAll(false));
    }
  }, [overrides, syncMut.isPending]);

  const overrideCount = overrides?.size ?? 0;
  const githubSubnetCount = curatedSubnets.filter((s) => s.githubUrl).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">Section · 03</p>
          <h1 className="text-display text-3xl font-bold tracking-tight md:text-4xl">
            Subnets
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {snap?.totalSubnets
              ? `${snap.totalSubnets} subnets on the live Finney chain — ${curatedSubnets.length} tracked in detail.`
              : `All Bittensor subnets tracked by the platform — ${curatedSubnets.length} on the Finney chain.`}
            {overrideCount > 0 && ` · ${overrideCount} with user overrides`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => handleSyncAll(true)}
            disabled={syncMut.isPending}
          >
            <Github className={cn("h-3.5 w-3.5", syncMut.isPending && "animate-spin")} />
            {syncMut.isPending ? "Syncing…" : "Sync from GitHub"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            {isFetching ? "Syncing…" : "Refresh chain"}
          </Button>
        </div>
      </header>

      {/* Data source legend + sync status */}
      <Card className="border-border/60 bg-card/40">
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          <Info className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Data sources:</span>
          <Badge variant="outline" className="border-success/30 text-[10px] text-success">
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-success" />
            Live (chain)
          </Badge>
          <Badge variant="outline" className="border-warning/30 text-[10px] text-warning">
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-warning" />
            User override
          </Badge>
          <Badge variant="outline" className="border-primary/30 text-[10px] text-primary">
            <Github className="mr-1 h-3 w-3" />
            GitHub ({githubSubnetCount} repos)
          </Badge>
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            Curated (default)
          </Badge>
          {syncMut.isPending && (
            <Badge variant="outline" className="text-[10px] text-primary">
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
              Scraping GitHub…
            </Badge>
          )}
          {overrideCount > 0 && !syncMut.isPending && (
            <Badge variant="outline" className="border-success/30 text-[10px] text-success">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {overrideCount} synced
            </Badge>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground">
            Click the ⚙ icon on any card to edit or scrape individually
          </span>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-card/40">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, category, netuid or tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search subnets"
            />
          </div>
          <div className="flex gap-2">
            {(["all", "active", "open"] as const).map((k) => (
              <Button
                key={k}
                variant={activeOnly === k ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveOnly(k)}
                className="capitalize"
              >
                {k === "open" ? "Registration open" : k}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card className="border-border/60 bg-card/40">
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
            <Network className="h-8 w-8" />
            <p className="text-sm">No subnets match your filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((s) => {
            const sr = scoreByNetuid.get(s.netuid);
            return (
              <SubnetCard
                key={s.netuid}
                subnet={s}
                score={sr?.score}
                rank={sr?.rank}
                onEdit={handleEdit}
                onViewRequirements={handleViewRequirements}
              />
            );
          })}
        </div>
      )}

      <SubnetEditDialog
        subnet={editSubnet}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <SubnetRequirementsDialog
        subnet={reqSubnet}
        open={reqOpen}
        onOpenChange={setReqOpen}
      />
    </div>
  );
}
