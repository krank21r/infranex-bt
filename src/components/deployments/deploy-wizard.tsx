"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Rocket,
  Search,
  Cpu,
  Wallet,
  Play,
  Server,
  Flame,
  Unlock,
  Hourglass,
  Terminal,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useNetwork, mergeSubnets } from "@/lib/infranex/use-network";
import { useMergedGpuOffers, type MergedGpuOffer } from "@/lib/infranex/use-gpu-offers";
import {
  useCreateDeployment,
  useDeploymentDetail,
  useTickDeployment,
  useRegistrationAction,
  type DeploymentStep,
  type RegistrationWizardContext,
} from "@/lib/infranex/use-deployments";
import { WalletRegistrationDialog } from "@/components/devops/wallet-registration-dialog";
import { assessSeatChance, formatBurnTao } from "@/lib/infranex/miner-score";
import type { SubnetRequirementsProfile } from "@/lib/devops/subnet-requirements";
import { useToast } from "@/hooks/use-toast";

/**
 * Deploy Wizard — the WHOLE mining journey in one dialog, in the user's own
 * order:
 *   1. Choose the subnet        (live chain list + seat verdicts)
 *   2. Check required GPU       (real requirements profiler)
 *   3. Buy the GPU              (filtered provider offers, mock or RunPod)
 *   4. Install requirements     (automatic — real 10-step runner, live log)
 *   5. Add hotkey & run         (wallet wizard hand-off, register LAST)
 *
 * Replaces the old 3-step CreateDeploymentDialog: nothing is scattered
 * across views anymore — rent → install → register flows end-to-end here.
 */

const STEP_LABELS = ["Subnet", "Requirements", "GPU", "Install", "Hotkey & run"];

/** What an entry point can preselect when opening the wizard (FLOW-1). */
export interface OpenDeployWizardOptions {
  /** Subnet chosen upstream (opportunity card / mining journey). */
  netuid?: number | null;
  /** GPU offer chosen upstream (GPU catalog "Provision"). */
  offerId?: string | null;
}

interface DeployWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preselect a subnet when opening (e.g. "Start mining" from an opportunity). */
  initialNetuid?: number | null;
  /** Preselect a GPU offer when opening (e.g. "Provision" from the catalog). */
  initialOfferId?: string | null;
  onCreated?: (id: string) => void;
}

export function DeployWizard({ open, onOpenChange, initialNetuid, initialOfferId, onCreated }: DeployWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [netuid, setNetuid] = useState<number | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [mode, setMode] = useState<"mock" | "runpod">("mock");
  const [minerName, setMinerName] = useState("");
  const [walletName, setWalletName] = useState("infranex");
  const [depId, setDepId] = useState<string | null>(null);
  const [regCtx, setRegCtx] = useState<RegistrationWizardContext | null>(null);
  const [regOpen, setRegOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  // Seed the preselection on every closed → open TRANSITION (not on mount,
  // not while open): the wizard is a singleton at the app root, so each
  // entry point (opportunity, GPU catalog, journey) re-seeds cleanly.
  // A subnet preselect lands on step 2 — "check required GPU" — the step
  // the user explicitly asked for after choosing the subnet.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const hasSubnet = initialNetuid != null;
      setNetuid(initialNetuid ?? null);
      setOfferId(initialOfferId ?? null);
      setStep(hasSubnet ? 2 : 1);
      setMode("mock");
      setMinerName("");
      setWalletName("infranex");
      setDepId(null);
      setRegCtx(null);
      setRegOpen(false);
      setSearch("");
    }
    wasOpen.current = open;
  }, [open, initialNetuid, initialOfferId]);

  const reset = () => {
    setStep(1);
    setNetuid(null);
    setOfferId(null);
    setMode("mock");
    setMinerName("");
    setWalletName("infranex");
    setDepId(null);
    setRegCtx(null);
    setRegOpen(false);
    setSearch("");
  };

  const handleClose = (o: boolean) => {
    onOpenChange(o);
    if (!o) reset();
  };

  // --- Step 1 data: live subnets (chain + curated merged) ------------------
  const { data: net, isLoading: netLoading } = useNetwork();
  const subnets = useMemo(() => mergeSubnets(net), [net]);
  const liveSubnet = useMemo(
    () => subnets.find((s) => s.netuid === netuid) ?? null,
    [subnets, netuid]
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? subnets.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            String(s.netuid) === q ||
            s.category.toLowerCase().includes(q)
        )
      : subnets;
    return list;
  }, [subnets, search]);

  // --- Step 2 data: real requirements profile ------------------------------
  const reqQ = useQuery({
    queryKey: ["wizard-requirements", netuid],
    queryFn: async () => {
      const res = await fetch(`/api/devops/subnet-requirements?netuid=${netuid}`, {
        cache: "no-store",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      return j.profile as SubnetRequirementsProfile;
    },
    enabled: open && netuid != null && step >= 2,
    staleTime: 10 * 60_000,
  });
  const profile = reqQ.data ?? null;
  const requiredVram = profile?.minVramGb ?? liveSubnet?.minVramGb ?? null;

  // --- Step 3 data: offers --------------------------------------------------
  const { offers, snap: offerSnap } = useMergedGpuOffers();
  // Legacy snapshots (no providers array) default to "configured" so the hint
  // never nags when the server can't tell us.
  const runpodConfigured = offerSnap?.providers
    ? Boolean(offerSnap.providers.find((p) => p.id === "runpod")?.configured)
    : true;
  const matchingOffers = useMemo(() => {
    if (requiredVram == null) return offers;
    return offers
      .filter((o) => o.vramGb >= requiredVram)
      .sort((a, b) => a.hourlyPrice - b.hourlyPrice);
  }, [offers, requiredVram]);
  const offer: MergedGpuOffer | null = offers.find((o) => o.id === offerId) ?? null;

  // --- Step 4/5 data: the deployment record --------------------------------
  const detail = useDeploymentDetail(step >= 4 ? depId : null);
  const dep = detail.data ?? null;
  const tickMut = useTickDeployment();
  const regAction = useRegistrationAction();

  // Derived step: the install step AUTO-COMPLETES into the hotkey step the
  // moment the miner is running — no extra click, no setState-in-effect.
  const effStep: 1 | 2 | 3 | 4 | 5 =
    step === 4 && dep?.status === "started" ? 5 : step;

  // Auto-tick the lifecycle while the user watches step 4.
  useEffect(() => {
    if (step !== 4 || !depId || !open) return;
    if (!dep) return;
    if (dep.status === "started" || dep.status === "failed" || dep.status === "terminated") return;
    if (tickMut.isPending) return;
    const t = setTimeout(() => tickMut.mutate(depId), 2600);
    return () => clearTimeout(t);
  }, [step, depId, open, dep?.status, dep?.installStatus, tickMut.isPending, tickMut.mutate]);

  // Step 5: fetch the wallet-wizard hand-off context once.
  useEffect(() => {
    if (effStep !== 5 || !depId || regCtx) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/deployments/${depId}/registration`, { cache: "no-store" });
        const j = await res.json();
        if (!cancelled && res.ok && j.wizard) setRegCtx(j.wizard as RegistrationWizardContext);
      } catch {
        /* the retry button re-fetches */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effStep, depId, regCtx]);

  const seat = liveSubnet
    ? assessSeatChance({
        minersCount: liveSubnet.minersCount,
        maxUids: liveSubnet.maxUids ?? null,
        burnCostTao: liveSubnet.burnCostTao ?? null,
        immunityBlocks: liveSubnet.immunityBlocks ?? null,
        rewardedMiners: liveSubnet.rewardedMiners ?? null,
      })
    : null;

  const createMut = useCreateDeployment();
  const handleCreate = async () => {
    if (!liveSubnet || !offer) return;
    try {
      const created = await createMut.mutateAsync({
        netuid: liveSubnet.netuid,
        offerId: offer.id,
        minerName: minerName.trim(),
        walletName: walletName.trim() || undefined,
        mode,
      });
      toast({
        title: "GPU rented — installing requirements",
        description: `${offer.model} for ${liveSubnet.name} (α${liveSubnet.netuid})`,
      });
      setDepId(created.id);
      onCreated?.(created.id);
      setStep(4);
    } catch (e) {
      toast({
        title: "Could not rent the GPU",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const registered = dep?.registrationState === "registered";
  const restartPending = registered && dep != null && !dep.restartedAfterRegistration;
  const fullyLive = registered && dep?.restartedAfterRegistration === true;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto custom-scroll">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-display text-2xl">
              <Rocket className="h-5 w-5 text-primary" />
              Deploy a miner
            </DialogTitle>
            <DialogDescription>
              Subnet → requirements → GPU → automatic install → hotkey &amp; run.
              {dep ? (
                <span className="ml-1 font-medium text-foreground">
                  Mining {dep.subnetName} (α{dep.netuid}) on {dep.gpuModel}.
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="grid grid-cols-5 gap-1.5" aria-label="Wizard progress">
            {STEP_LABELS.map((label, i) => {
              const n = (i + 1) as 1 | 2 | 3 | 4 | 5;
              const reached = effStep >= n;
              const current = effStep === n;
              return (
                <div key={label} className="space-y-1">
                  <div
                    className={cn(
                      "h-1.5 rounded-full transition-colors",
                      reached ? "bg-primary" : "bg-muted",
                      current && "ring-2 ring-primary/30"
                    )}
                  />
                  <p
                    className={cn(
                      "text-[10px] leading-tight",
                      current ? "font-semibold text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {i + 1}. {label}
                  </p>
                </div>
              );
            })}
          </div>

          {/* ------------------------- STEP 1 ------------------------- */}
          {effStep === 1 && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search 120+ live subnets — name, netuid or category…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              {netLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading the live chain…</span>
                </div>
              ) : (
                <div className="max-h-80 space-y-1.5 overflow-y-auto custom-scroll pr-1">
                  {filtered.map((s) => {
                    const seatHere = assessSeatChance({
                      minersCount: s.minersCount,
                      maxUids: s.maxUids ?? null,
                      burnCostTao: s.burnCostTao ?? null,
                      immunityBlocks: s.immunityBlocks ?? null,
                      rewardedMiners: s.rewardedMiners ?? null,
                    });
                    const selected = netuid === s.netuid;
                    return (
                      <button
                        key={s.netuid}
                        type="button"
                        onClick={() => {
                          setNetuid(s.netuid);
                          setMinerName(
                            minerName || `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-01`
                          );
                        }}
                        className={cn(
                          "w-full rounded-lg border p-3 text-left transition-colors",
                          selected
                            ? "border-primary/50 bg-primary/[0.06]"
                            : "border-border/60 bg-card/30 hover:border-border"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="mono text-xs text-muted-foreground">α{s.netuid}</span>
                            <span className="truncate text-sm font-semibold">{s.name}</span>
                            <Badge variant="outline" className="hidden text-[9px] sm:inline-flex">
                              {s.category}
                            </Badge>
                          </div>
                          <SeatChip verdict={seatHere.verdict} headline={seatHere.headline} />
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {s.minersCount}/{s.maxUids ?? "?"} seats · min {s.minVramGb}GB VRAM ·{" "}
                          {s.rewardedMiners ?? "?"} earned last epoch
                        </p>
                      </button>
                    );
                  })}
                  {filtered.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No subnet matches “{search}”.
                    </p>
                  )}
                </div>
              )}
              <div className="flex justify-end">
                <Button disabled={netuid == null} onClick={() => setStep(2)} className="gap-1.5">
                  Check requirements
                </Button>
              </div>
            </div>
          )}

          {/* ------------------------- STEP 2 ------------------------- */}
          {effStep === 2 && liveSubnet && (
            <div className="space-y-3">
              {reqQ.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">
                    Profiling α{liveSubnet.netuid} — chain identity + GitHub repo…
                  </span>
                </div>
              ) : reqQ.isError || !profile ? (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.04] p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="text-xs">
                    <p className="font-medium text-warning">Profiler unavailable</p>
                    <p className="mt-1 text-muted-foreground">
                      Falling back to the catalog requirement: min {liveSubnet.minVramGb}GB ·{" "}
                      {liveSubnet.recommendedGpu}.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <ReqStat label="Min VRAM" value={`${profile.minVramGb} GB`} />
                    <ReqStat label="Recommended GPU" value={profile.recommendedGpu} small />
                    <ReqStat label="Runtime" value={profile.dockerfileFound ? "Docker" : "venv"} />
                    <ReqStat
                      label="Python / CUDA"
                      value={`${profile.pythonVersion ?? "distro"} · ${profile.cudaMinVersion ?? "—"}`}
                      small
                    />
                  </div>
                  <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-xs">
                    <p className="text-eyebrow mb-1.5 text-muted-foreground">
                      What gets installed automatically
                    </p>
                    <p className="leading-relaxed text-muted-foreground">
                      {profile.osPackages.length} OS packages · {profile.pipPackageCount} pip deps
                      {profile.bittensorStack.length > 0
                        ? ` · ${profile.bittensorStack.join(", ")}`
                        : ""}
                      {profile.entrypoint ? ` · entrypoint ${profile.entrypoint}` : ""} ·{" "}
                      {profile.repoUrl ? "repo cloned from GitHub" : "curated plan"}
                    </p>
                  </div>
                  {seat && seat.verdict === "burn-entry" && (
                    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/[0.04] p-3 text-xs">
                      <Flame className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <p className="text-muted-foreground">
                        <span className="font-medium text-warning">Full subnet — burn entry.</span>{" "}
                        {seat.headline.replace(`full (${seat.totalSlots}/${seat.totalSlots}) — `, "")}{" "}
                        · immunity ~{seat.immunityHours}h for the new seat. Registration happens LAST
                        (step 5) so the clock starts only when you are ready.
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button onClick={() => setStep(3)} className="gap-1.5">
                  Find a GPU
                </Button>
              </div>
            </div>
          )}

          {/* ------------------------- STEP 3 ------------------------- */}
          {effStep === 3 && liveSubnet && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Offers meeting the{" "}
                <span className="font-medium text-foreground">{requiredVram ?? "?"}GB</span>{" "}
                requirement, cheapest first.
              </p>
              {offer && !matchingOffers.some((o) => o.id === offer.id) && (
                <p className="rounded-lg border border-warning/30 bg-warning/[0.04] p-2.5 text-xs text-warning">
                  The preselected {offer.model} falls short of {requiredVram}GB for this subnet —
                  pick one from the list below.
                </p>
              )}
              <div className="max-h-56 space-y-1.5 overflow-y-auto custom-scroll pr-1">
                {matchingOffers.map((o) => {
                  const selected = offerId === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setOfferId(o.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors",
                        selected
                          ? "border-primary/50 bg-primary/[0.06]"
                          : "border-border/60 bg-card/30 hover:border-border"
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Cpu className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {o.model}{" "}
                            <span className="font-normal text-muted-foreground">
                              · {o.vramGb}GB
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {o.provider} · {o.region}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {o.live && (
                          <Badge variant="outline" className="border-success/30 text-[9px] text-success">
                            live
                          </Badge>
                        )}
                        <span className="mono tabular text-sm font-semibold text-primary">
                          ${o.hourlyPrice.toFixed(2)}/hr
                        </span>
                      </div>
                    </button>
                  );
                })}
                {matchingOffers.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No offer meets {requiredVram}GB — pick a smaller subnet or add providers.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("mock")}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    mode === "mock" ? "border-primary/40 bg-primary/[0.06]" : "border-border/60 bg-card/30"
                  )}
                >
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Server className="h-4 w-4 text-primary" /> Demo pod
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Simulated machine, same installer. Free.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("runpod")}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    mode === "runpod" ? "border-primary/40 bg-primary/[0.06]" : "border-border/60 bg-card/30"
                  )}
                >
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Rocket className="h-4 w-4 text-warning" /> RunPod (real)
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Real GPU pod — billed until you terminate.
                  </p>
                </button>
              </div>

              {mode === "runpod" && !runpodConfigured && (
                <p className="-mt-1 flex items-start gap-1.5 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  No RunPod API key yet — add it in GPU catalog → “Provider API keys”, or run the Demo pod first.
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="wiz-miner-name" className="text-sm font-medium">
                    Miner name
                  </Label>
                  <Input
                    id="wiz-miner-name"
                    value={minerName}
                    onChange={(e) => setMinerName(e.target.value)}
                    placeholder="chutes-miner-01"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="wiz-wallet" className="text-sm font-medium">
                    Wallet name
                  </Label>
                  <Input
                    id="wiz-wallet"
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    placeholder="infranex"
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-card/40 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Rent</span>
                  <span className="mono tabular font-medium">
                    {offer ? `${offer.model} · $${offer.hourlyPrice.toFixed(2)}/hr (~${formatCurrency(offer.monthlyPrice)}/mo)` : "—"}
                  </span>
                </div>
                <Separator className="my-2" />
                <p className="text-xs text-muted-foreground">
                  Renting starts the automatic install (step 4). The hotkey is added LAST (step 5)
                  — registration starts the immunity clock, so it happens when everything already
                  runs.
                </p>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button
                  disabled={!offer || !minerName.trim() || createMut.isPending}
                  onClick={handleCreate}
                  className="gap-1.5"
                >
                  {createMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  {mode === "runpod" ? "Rent & deploy (real)" : "Rent & install"}
                </Button>
              </div>
            </div>
          )}

          {/* ------------------------- STEP 4 ------------------------- */}
          {effStep === 4 && (
            <div className="space-y-3">
              {!dep ? (
                <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Loading the deployment…</span>
                </div>
              ) : dep.status === "failed" ? (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.04] p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="text-xs">
                    <p className="font-medium text-destructive">Install failed</p>
                    <p className="mt-1 text-muted-foreground">
                      Check the log below. Retry re-runs the failed phase; nothing was registered
                      on-chain.
                    </p>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => depId && tickMut.mutate(depId)}>
                      Retry install
                    </Button>
                  </div>
                </div>
              ) : dep.status === "started" ? (
                <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/[0.05] p-4 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Miner is running — opening the hotkey step…
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>
                    {dep.status === "provisioning"
                      ? "Renting the GPU pod…"
                      : dep.status === "setup"
                        ? `Installing the subnet's requirements${
                            dep.installSteps?.length
                              ? ` — ${dep.installSteps.filter((s) => s.status === "done").length}/${dep.installSteps.length} steps`
                              : ""
                          }…`
                        : dep.status === "deploying"
                          ? "Launching the miner…"
                          : "Working…"}
                  </span>
                </div>
              )}

              {dep && <PipelineLog steps={dep.steps} />}

              {dep && dep.status !== "started" && dep.status !== "failed" && (
                <p className="text-center text-xs text-muted-foreground">
                  This runs unattended — the pod is rented, the installer stages the subnet&apos;s
                  real plan and launches the miner. Step 5 opens by itself when the miner is live.
                </p>
              )}
            </div>
          )}

          {/* ------------------------- STEP 5 ------------------------- */}
          {effStep === 5 && dep && (
            <div className="space-y-3">
              {fullyLive ? (
                <div className="rounded-lg border border-success/30 bg-success/[0.05] p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    Live — UID {dep.registeredUid} on α{dep.netuid}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Registration block #{dep.registrationBlock ?? "?"} — your immunity countdown is
                    ticking in the UID Defense panel. axon re-announced after the approval restart.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {registered ? (
                    <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/[0.05] p-3 text-sm">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                      <span>
                        Registered — <span className="font-medium">UID {dep.registeredUid}</span> on
                        α{dep.netuid}.
                        {restartPending && " One approval restart left so validators find you."}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 p-3 text-xs text-muted-foreground">
                      <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <p>
                        The miner is running and serving — but still <span className="font-medium text-foreground">unregistered</span>
                        {" "}({dep.hotkey ? "hotkey attached" : "no hotkey yet"}). Open the wallet
                        wizard to create/fund the coldkey, register on α{dep.netuid}, then verify
                        here. Registration is LAST on purpose — it starts the immunity clock.
                      </p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant={registered ? "outline" : "default"}
                      className="gap-1.5"
                      disabled={!!regCtx && regCtx.deploymentId !== dep.id}
                      onClick={() => setRegOpen(true)}
                    >
                      <Wallet className="h-4 w-4" />
                      {registered ? "Wallet & registration" : "Open wallet wizard — create hotkey & register"}
                    </Button>
                    {registered && restartPending && (
                      <Button
                        className="gap-1.5"
                        disabled={regAction.isPending}
                        onClick={async () => {
                          if (!depId) return;
                          try {
                            await regAction.mutateAsync({ id: depId, action: "restart" });
                            toast({ title: "Miner restarted — axon re-announced for the new UID" });
                            qc.invalidateQueries({ queryKey: ["deployments"] });
                            qc.invalidateQueries({ queryKey: ["deployment", depId] });
                          } catch (e) {
                            toast({
                              title: "Restart failed",
                              description: e instanceof Error ? e.message : "Unknown error",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        {regAction.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        Restart miner (approval)
                      </Button>
                    )}
                    {registered && !restartPending && !fullyLive && (
                      <Button
                        variant="outline"
                        onClick={() => depId && regAction.mutate({ id: depId, action: "check" })}
                      >
                        Verify on-chain now
                      </Button>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <Terminal className="h-3.5 w-3.5" /> What just happened
                </p>
                <p className="mt-1 leading-relaxed">
                  Rented {dep.gpuModel} → installed {dep.subnetName}&apos;s real requirements →
                  miner launched as a service
                  {fullyLive
                    ? " → hotkey attached & registered → approval restart re-announced the axon"
                    : " → the hotkey & registration happen here, LAST"}
                  . The deployment card tracks health, earnings and immunity from here.
                </p>
              </div>
              {fullyLive && (
                <div className="flex justify-end">
                  <Button onClick={() => handleClose(false)}>Done</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* The existing wallet & registration wizard, bound to THIS deployment */}
      <WalletRegistrationDialog
        open={regOpen}
        onOpenChange={setRegOpen}
        journey={null}
        minerDeployed
        deployment={regCtx}
        onLinked={() => {
          qc.invalidateQueries({ queryKey: ["deployments"] });
          qc.invalidateQueries({ queryKey: ["deployment", depId] });
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function SeatChip({ verdict, headline }: { verdict: string; headline: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    open: { cls: "border-success/40 text-success", icon: <Unlock className="h-3 w-3" /> },
    "burn-entry": { cls: "border-warning/40 text-warning", icon: <Flame className="h-3 w-3" /> },
    waitlist: { cls: "text-muted-foreground", icon: <Hourglass className="h-3 w-3" /> },
    unknown: { cls: "text-muted-foreground", icon: <Hourglass className="h-3 w-3" /> },
  };
  const m = map[verdict] ?? map.unknown;
  return (
    <Badge variant="outline" className={cn("shrink-0 gap-1 text-[9px]", m.cls)} title={headline}>
      {m.icon}
      {verdict === "burn-entry" ? "burn entry" : verdict}
    </Badge>
  );
}

function ReqStat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-medium", small ? "text-xs" : "mono tabular text-sm")}>{value}</p>
    </div>
  );
}

function PipelineLog({ steps }: { steps: DeploymentStep[] }) {
  const visible = steps.filter((s) => s.status !== "pending");
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 p-3">
      <p className="text-eyebrow mb-2 text-muted-foreground">Live install log</p>
      <div className="max-h-56 space-y-2 overflow-y-auto custom-scroll pr-1 font-mono text-[11px]">
        {visible.map((s) => (
          <div key={s.name}>
            <p
              className={cn(
                "flex items-center gap-1.5 font-sans text-xs font-semibold",
                s.status === "done"
                  ? "text-success"
                  : s.status === "failed"
                    ? "text-destructive"
                    : "text-foreground"
              )}
            >
              {s.status === "done" ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : s.status === "failed" ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              {s.label}
            </p>
            {s.output.slice(-4).map((line, i) => (
              <p key={i} className="ml-4 truncate text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        ))}
        {visible.length === 0 && (
          <p className="py-4 text-center font-sans text-xs text-muted-foreground">
            Waiting for the pipeline to start…
          </p>
        )}
      </div>
    </div>
  );
}
