"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRightLeft, Loader2, ServerCog } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMergedGpuOffers, type MergedGpuOffer } from "@/lib/infranex/use-gpu-offers";
import { offerProviderId } from "@/lib/infranex/types";
import { cn } from "@/lib/utils";

/**
 * TIER3 — migrate a started deployment to a different GPU offer.
 *
 * Provision new pod → switch → re-bridge → terminate old pod, all recorded
 * as a "migrate" revision + step trail. Mock fleets migrate within the
 * simulated fleet (preset synthetic targets); live deployments migrate onto
 * on-demand offers from their own rental provider (RunPod or Vast.ai).
 */

interface MigrationResultDTO {
  from: { providerPodId: string | null; gpuModel: string; hourlyCost: number };
  to: { providerPodId: string; gpuModel: string; hourlyCost: number; region: string };
  note: string;
  transport: string;
}

/** Simulated targets for the mock fleet — provider "mock" keeps mode semantics. */
const MOCK_TARGETS: MergedGpuOffer[] = [
  {
    id: "mock-migrate-4090",
    model: "RTX 4090",
    vramGb: 24,
    provider: "mock",
    region: "simulated",
    hourlyPrice: 0.4,
    monthlyPrice: 288,
    availability: "available",
    isSpot: false,
    ramGb: 64,
    cpuCores: 16,
  },
  {
    id: "mock-migrate-6000",
    model: "RTX 6000 Ada",
    vramGb: 48,
    provider: "mock",
    region: "simulated",
    hourlyPrice: 0.79,
    monthlyPrice: 569,
    availability: "available",
    isSpot: false,
    ramGb: 128,
    cpuCores: 32,
  },
  {
    id: "mock-migrate-h100",
    model: "H100",
    vramGb: 80,
    provider: "mock",
    region: "simulated",
    hourlyPrice: 2.49,
    monthlyPrice: 1793,
    availability: "available",
    isSpot: false,
    ramGb: 240,
    cpuCores: 48,
  },
];

export function MigrateDialog({
  deploymentId,
  minerName,
  mode,
  currentGpuModel,
  currentHourlyCost,
  open,
  onOpenChange,
}: {
  deploymentId: string;
  minerName: string;
  mode: string;
  currentGpuModel: string;
  currentHourlyCost: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const { offers, isFetching: offersFetching } = useMergedGpuOffers();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<MigrationResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMock = mode === "mock";
  // TIER4 — live targets come from the deployment's own rental provider
  // (offerProviderId normalizes the inconsistent catalog label casings that
  // previously made live RunPod targets unmatchable), excluding spot + the
  // current model.
  const liveProvider = mode === "vast" ? "vast" : "runpod";
  const liveTargets = offers.filter(
    (o) => offerProviderId(o.provider) === liveProvider && !o.isSpot && o.model !== currentGpuModel
  );
  const targets = isMock
    ? MOCK_TARGETS.filter((t) => t.model !== currentGpuModel)
    : liveTargets;

  const migrate = async (offer: MergedGpuOffer) => {
    setBusyId(offer.id);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/deployments/${deploymentId}/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `migration failed (${res.status})`);
      setResult(j.migration as MigrationResultDTO);
      qc.invalidateQueries({ queryKey: ["deployments"] });
      qc.invalidateQueries({ queryKey: ["devops-monitor"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Migration failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="h-4 w-4 text-primary" aria-hidden />
            Migrate &quot;{minerName}&quot;
          </DialogTitle>
          <DialogDescription>
            {isMock
              ? "Simulated migration inside the mock fleet — the pod swap, billing change and audit trail all behave like the real path."
              : "Provisions the new pod first, switches the deployment, re-bridges DevOps, then terminates the old pod. The miner config (subnet, hotkey, env) is untouched."}
          </DialogDescription>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Current: <span className="text-foreground/90">{currentGpuModel}</span> · $
          {currentHourlyCost.toFixed(2)}/h. Picking a target below executes immediately.
        </p>

        <ScrollArea className="max-h-72 pr-2">
          <div className="space-y-1.5">
            {offersFetching && !isMock && targets.length === 0 && (
              <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Loading live offers…
              </p>
            )}
            {!offersFetching && targets.length === 0 && (
              <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
                {isMock
                  ? "No other mock targets available."
                  : `No eligible ${liveProvider === "vast" ? "Vast.ai" : "RunPod"} on-demand offers right now (spot offers are refused for long-running miners).`}
              </p>
            )}
            {targets.map((o) => (
              <div
                key={o.id}
                className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/30 px-2.5 py-2"
              >
                <ServerCog className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium leading-tight">
                    {o.model}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {o.vramGb}GB · {o.region}
                    </span>
                  </p>
                  <p className="mono text-[10px] text-muted-foreground/70">
                    ${o.hourlyPrice.toFixed(2)}/h · ${o.monthlyPrice.toFixed(0)}/mo
                    {o.hourlyPrice < currentHourlyCost && (
                      <span className="ml-1.5 text-emerald-500">cheaper</span>
                    )}
                  </p>
                </div>
                {o.live && (
                  <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[9px] text-muted-foreground">
                    live
                  </Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className={cn("h-7 shrink-0 gap-1 px-2 text-xs")}
                  disabled={busyId !== null}
                  onClick={() => migrate(o)}
                >
                  {busyId === o.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  ) : (
                    <ArrowRightLeft className="h-3 w-3" aria-hidden />
                  )}
                  Migrate
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>

        {error && (
          <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {result && (
          <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
            {result.note}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
