"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Cpu,
  Zap,
  Sparkles,
  Server,
  MapPin,
  RefreshCw,
  Loader2,
  WifiOff,
} from "lucide-react";
import { gpuModels, gpuProviders } from "@/lib/infranex/data";
import { useMergedGpuOffers } from "@/lib/infranex/use-gpu-offers";
import { cn, formatCurrency } from "@/lib/utils";

export function GpusView() {
  const [tier, setTier] = useState<string>("all");
  const [minVram, setMinVram] = useState<string>("");
  const [offerProvider, setOfferProvider] = useState<string>("all");
  const [offerSort, setOfferSort] = useState<string>("hourlyPrice");
  const [offerMaxPrice, setOfferMaxPrice] = useState<string>("");

  const { offers: allOffers, snap, isLive, isFetching, refetch } = useMergedGpuOffers();

  const filteredModels = useMemo(() => {
    return gpuModels.filter((g) => {
      if (tier !== "all" && g.tierLabel !== tier) return false;
      if (minVram && g.vramGb < Number(minVram)) return false;
      return true;
    });
  }, [tier, minVram]);

  const filteredOffers = useMemo(() => {
    let r = allOffers.filter((o) => {
      if (offerProvider !== "all" && o.provider !== offerProvider) return false;
      if (offerMaxPrice && o.hourlyPrice > Number(offerMaxPrice)) return false;
      return true;
    });
    r = [...r].sort((a, b) => {
      const dir = offerSort === "hourlyPrice" ? 1 : -1;
      if (offerSort === "hourlyPrice") return (a.hourlyPrice - b.hourlyPrice) * dir;
      if (offerSort === "vramGb") return (b.vramGb - a.vramGb) * dir;
      return 0;
    });
    return r;
  }, [allOffers, offerProvider, offerSort, offerMaxPrice]);

  // Prefer the cheapest LIVE H100; fall back to indicative if no live offers.
  const liveH100s = allOffers.filter((o) => o.live && o.model.includes("H100"));
  const h100Pool = liveH100s.length > 0 ? liveH100s : allOffers.filter((o) => o.model.includes("H100"));
  const cheapestH100 = h100Pool.sort((a, b) => a.hourlyPrice - b.hourlyPrice)[0];
  const liveCount = allOffers.filter((o) => o.live).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">Section · 04</p>
          <h1 className="animate-rise text-display text-3xl font-bold tracking-tight md:text-4xl">
            GPU Catalog
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Match the best GPU to the best subnet. {isLive ? `${liveCount} live RunPod offers` : "Live RunPod pricing"}{snap?.totalGpuTypes ? ` across ${snap.totalGpuTypes} GPU types` : ""}, plus indicative pricing from {gpuProviders.length - 1} other providers.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 self-start sm:self-end"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          {isFetching ? "Syncing…" : "Refresh prices"}
        </Button>
      </header>

      {/* Recommendation highlight */}
      {cheapestH100 && (
      <Card className={cn("border-primary/30 bg-primary/[0.04]", !isLive && "border-warning/30 bg-warning/[0.04]")}>
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg border", isLive ? "border-primary/40 bg-primary/10 text-primary" : "border-warning/40 bg-warning/10 text-warning")}>
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className={cn("text-eyebrow", isLive ? "text-primary" : "text-warning")}>
                {isLive ? "Live top recommendation" : "Indicative recommendation"}
              </p>
              <p className="text-display text-xl font-semibold">
                {cheapestH100.model} ·{" "}
                <span className={isLive ? "text-primary" : "text-warning"}>{cheapestH100.provider}</span>
                {cheapestH100.live && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-normal text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" /> live
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Cheapest H100 80GB — best fit for subnets 3, 7, 9, 19, 23
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Hourly</p>
              <p className={cn("tabular text-2xl font-bold", isLive ? "text-primary" : "text-warning")}>
                ${cheapestH100.hourlyPrice.toFixed(2)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Monthly</p>
              <p className="tabular text-lg font-semibold">
                ${cheapestH100.monthlyPrice}
              </p>
            </div>
            <Button className="gap-2">
              <Zap className="h-4 w-4" />
              Provision
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      <Tabs defaultValue="offers">
        <TabsList>
          <TabsTrigger value="offers" className="gap-1.5">
            <Server className="h-3.5 w-3.5" />
            Live offers
          </TabsTrigger>
          <TabsTrigger value="models" className="gap-1.5">
            <Cpu className="h-3.5 w-3.5" />
            GPU models
          </TabsTrigger>
        </TabsList>

        {/* Offers */}
        <TabsContent value="offers">
          <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <CardTitle className="text-display text-xl">GPU offers</CardTitle>
                {isLive ? (
                  <Badge variant="outline" className="border-success/30 text-[10px] text-success">
                    <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-success" />
                    RunPod live · {liveCount} offers
                  </Badge>
                ) : snap?.source === "error" ? (
                  <Badge variant="outline" className="border-destructive/30 text-[10px] text-destructive">
                    <WifiOff className="mr-1 h-3 w-3" />
                    RunPod offline
                  </Badge>
                ) : isFetching ? (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Syncing…
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={offerProvider} onValueChange={setOfferProvider}>
                  <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue placeholder="Provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All providers</SelectItem>
                    {gpuProviders.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={offerSort} onValueChange={setOfferSort}>
                  <SelectTrigger className="h-8 w-[150px]">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourlyPrice">Price: low → high</SelectItem>
                    <SelectItem value="-hourlyPrice">Price: high → low</SelectItem>
                    <SelectItem value="vramGb">VRAM: high → low</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Max $/hr"
                  className="h-8 w-24"
                  value={offerMaxPrice}
                  onChange={(e) => setOfferMaxPrice(e.target.value)}
                  type="number"
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="table-container">
                <Table>
                  <TableHeader>
                    <TableRow className="table-header hover:bg-transparent">
                      <TableHead>GPU</TableHead>
                      <TableHead>VRAM</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Region</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Availability</TableHead>
                      <TableHead className="text-right">Hourly</TableHead>
                      <TableHead className="text-right">Monthly</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOffers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                          No offers match your filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                    filteredOffers.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{o.model}</span>
                            {o.live ? (
                              <Badge variant="outline" className="border-success/30 text-[9px] text-success">
                                live
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] text-muted-foreground">
                                indicative
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="mono tabular">{o.vramGb} GB</TableCell>
                        <TableCell>{o.provider}</TableCell>
                        <TableCell className="text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {o.region}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {o.isSpot ? "spot" : "on-demand"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "badge-status",
                              o.availability === "available"
                                ? "bg-success/10 text-success"
                                : o.availability === "limited"
                                  ? "bg-warning/10 text-warning"
                                  : "bg-destructive/10 text-destructive"
                            )}
                          >
                            {o.availability}
                          </span>
                        </TableCell>
                        <TableCell className={cn("text-right tabular font-medium", o.live ? "text-primary" : "text-muted-foreground")}>
                          ${o.hourlyPrice.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right tabular">
                          ${o.monthlyPrice}
                        </TableCell>
                      </TableRow>
                    ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Models */}
        <TabsContent value="models">
          <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-display text-xl">GPU models</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="h-8 w-[120px]">
                    <SelectValue placeholder="Tier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All tiers</SelectItem>
                    <SelectItem value="Entry">Entry</SelectItem>
                    <SelectItem value="Mid">Mid</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Flagship">Flagship</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Min VRAM (GB)"
                  className="h-8 w-32"
                  value={minVram}
                  onChange={(e) => setMinVram(e.target.value)}
                  type="number"
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredModels.map((g) => (
                  <Card key={g.id} className="border-border/60 bg-card/60">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-display font-semibold">{g.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {g.manufacturer} · {g.generation}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            g.tierLabel === "Flagship"
                              ? "border-primary/40 text-primary"
                              : ""
                          )}
                        >
                          {g.tierLabel}
                        </Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
                        <div>
                          <p className="text-[10px] text-muted-foreground">VRAM</p>
                          <p className="mono tabular font-medium">{g.vramGb} GB</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">FP16</p>
                          <p className="mono tabular font-medium">{g.fp16Tflops} TF</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">Cores</p>
                          <p className="mono tabular font-medium">
                            {g.cudaCores.toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-muted-foreground">TDP</p>
                          <p className="mono tabular font-medium">{g.tdpWatts} W</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
