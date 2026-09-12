"use client";

// ---------------------------------------------------------------------------
// Mining Journey — the guided path the DevOps Engine walks, shown as a live
// 5-step stepper at the top of the section:
//
//   1 CHOOSE SUBNET  → pull THAT subnet's own requirements (GPU/VRAM, python,
//                      pip deps, CUDA, repo) so you know WHICH GPU to rent
//                      before you spend money
//   2 GET A GPU HOST → rent a matching GPU (RunPod / Vast / Lambda) or use
//                      your own box, connect it over SSH
//   3 VALIDATE       → the 10-step environment pipeline checks + fixes the box
//   4 DEPLOY & MINE  → engine installs the subnet's requirements on the host
//                      and launches the miner as a systemd service
//   5 CONNECT        → create the bittensor wallet on the laptop (coldkey +
//                      hotkey), fund it, copy the keys to the host, REGISTER
//                      the hotkey to the subnet (burn → UID) and verify it
//                      live against the chain metagraph
//
// The chosen journey subnet persists in localStorage and pre-selects the
// deploy dialog so every menu follows the same steps.
// ---------------------------------------------------------------------------

import { useMemo, useSyncExternalStore, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  ChevronRight,
  CloudDownload,
  KeyRound,
  Loader2,
  Pickaxe,
  RefreshCw,
  Rocket,
  Search,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDeploySubnetOptions,
  useSubnetRequirements,
  type DevopsHost,
} from "@/lib/devops/use-devops";
import { ProfileCard } from "./deploy-subnet-dialog";
import { WalletRegistrationDialog } from "./wallet-registration-dialog";
import { useWalletRegistration } from "@/lib/devops/wallet-registration";
import {
  useDeployments,
  type RegistrationWizardContext,
} from "@/lib/infranex/use-deployments";
import { resolveJourneyProgress } from "@/lib/infranex/journey-progress";

// ---------------------------------------------------------------------------
// Journey state (localStorage-persisted)
// ---------------------------------------------------------------------------

export interface JourneySubnet {
  netuid: number;
  name: string;
  gpuRequired: string;
  recommendedGpu: string;
  minVramGb: number;
  confidence: string;
}

const JOURNEY_KEY = "infranex.journeySubnet";

// Cached loader — useSyncExternalStore requires a stable snapshot identity,
// so parse only when the raw storage value actually changed.
let snapshotCache: { raw: string; val: JourneySubnet | null } | null = null;

export function loadJourney(): JourneySubnet | null {
  try {
    const raw = window.localStorage.getItem(JOURNEY_KEY) ?? "";
    if (snapshotCache && snapshotCache.raw === raw) return snapshotCache.val;
    const val = raw ? (JSON.parse(raw) as JourneySubnet) : null;
    snapshotCache = { raw, val };
    return val;
  } catch {
    return null;
  }
}

let listeners: Array<() => void> = [];

function subscribe(cb: () => void) {
  listeners.push(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
    window.removeEventListener("storage", cb);
  };
}

function emitJourneyChange() {
  for (const l of listeners) l();
}

export function saveJourney(j: JourneySubnet | null) {
  try {
    if (j) window.localStorage.setItem(JOURNEY_KEY, JSON.stringify(j));
    else window.localStorage.removeItem(JOURNEY_KEY);
  } catch {
    /* private mode — journey just won't persist */
  }
  snapshotCache = null;
  emitJourneyChange();
}

/** Reactive journey state — SSR-safe, hydrates without mismatch, cross-tab synced. */
export function useJourney(): JourneySubnet | null {
  return useSyncExternalStore(subscribe, loadJourney, () => null);
}

// ---------------------------------------------------------------------------
// Step 1 dialog — pick a subnet, pull its real requirements, confirm.
// Mirrors the deploy dialog's requirements stage but ends in "use this subnet"
// instead of an install plan.
// ---------------------------------------------------------------------------

export function PickSubnetDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (j: JourneySubnet) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedNetuid, setSelectedNetuid] = useState<number | null>(null);
  const [pullFor, setPullFor] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const options = useDeploySubnetOptions();
  const requirements = useSubnetRequirements(pullFor, refreshKey > 0);

  const profile = requirements.data?.profile ?? null;
  const selected = (options.data ?? []).find((r) => r.netuid === selectedNetuid) ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = options.data ?? [];
    if (!q) return rows.slice(0, 8);
    return rows
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          String(r.netuid) === q ||
          r.category.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [options.data, search]);

  const confirm = () => {
    if (!profile) return;
    onConfirm({
      netuid: profile.netuid,
      name: profile.subnetName,
      gpuRequired: selected?.gpuRequired ?? profile.recommendedGpu,
      recommendedGpu: profile.recommendedGpu,
      minVramGb: profile.minVramGb,
      confidence: profile.confidence,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pickaxe className="h-4 w-4 text-primary" />
            Step 1 — choose what to mine
          </DialogTitle>
          <DialogDescription>
            Pick a subnet from the live 129. The engine pulls that subnet&apos;s real
            requirements so you know exactly which GPU to rent before you spend money.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subnets (name, netuid, category)…"
              className="pl-8"
            />
          </div>

          <div className="max-h-52 space-y-1 overflow-y-auto">
            {options.isLoading && (
              <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading live subnets…
              </p>
            )}
            {filtered.map((r) => (
              <button
                key={r.netuid}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border p-2 text-left text-xs transition-colors",
                  selectedNetuid === r.netuid
                    ? "border-primary/50 bg-primary/5"
                    : "border-border/60 hover:bg-muted/20"
                )}
                onClick={() => setSelectedNetuid(r.netuid)}
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  SN{String(r.netuid).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
                  {r.gpuRequired}
                </span>
              </button>
            ))}
            {!options.isLoading && filtered.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">No subnets match.</p>
            )}
          </div>

          {selected && !profile && (
            <Button
              className="w-full gap-2"
              disabled={requirements.isFetching}
              onClick={() => setPullFor(selected.netuid)}
            >
              {requirements.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CloudDownload className="h-4 w-4" />
              )}
              {requirements.isFetching
                ? "Pulling requirements from the subnet…"
                : `Pull requirements for SN${selected.netuid} ${selected.name}`}
            </Button>
          )}

          {profile && <ProfileCard profile={profile} />}

          {profile && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button className="gap-2" onClick={confirm}>
                <CheckCircle2 className="h-4 w-4" />
                Mine this subnet
              </Button>
              <Button
                variant="outline"
                className="gap-1.5"
                disabled={requirements.isFetching}
                onClick={() => setRefreshKey((k) => k + 1)}
              >
                <RefreshCw className={cn("h-4 w-4", requirements.isFetching && "animate-spin")} />
                Re-pull (bypass cache)
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The stepper itself
// ---------------------------------------------------------------------------

function StepBubble({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
        done
          ? "border-success/50 bg-success/10 text-success"
          : active
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border bg-muted/30 text-muted-foreground"
      )}
    >
      {done ? <CheckCircle2 className="h-4 w-4" /> : n}
    </span>
  );
}

export function MiningJourney({
  hosts,
  journey,
  onPickSubnet,
  onClearSubnet,
  onAddHost,
  onValidate,
  onDeploy,
  onRent,
}: {
  hosts: DevopsHost[];
  journey: JourneySubnet | null;
  onPickSubnet: () => void;
  onClearSubnet: () => void;
  onAddHost: () => void;
  onValidate: (hostId: string) => void;
  onDeploy: (hostId: string) => void;
  /** FLOW-1 — open the guided deploy wizard (rental path, subnet preselected). */
  onRent?: () => void;
}) {
  const primary =
    hosts.find((h) => h.status === "ready") ??
    hosts.find((h) => h.status === "needs_fix") ??
    hosts[0] ??
    null;

  const reg = useWalletRegistration();
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletCtx, setWalletCtx] = useState<RegistrationWizardContext | null>(null);

  // Phase 3: the stepper is driven by the REAL deployment rows (rental
  // pipeline) on top of the BYO-host signals. The deployments query is
  // shared with the view's 3 s poll — no extra traffic.
  const { data: deployments } = useDeployments();
  const progress = useMemo(
    () =>
      resolveJourneyProgress({
        journey,
        hosts: hosts.map((h) => ({ status: h.status, latestInstall: h.latestInstall ?? null })),
        deployments: (deployments ?? []).map((d) => ({
          id: d.id,
          minerName: d.minerName,
          netuid: d.netuid,
          status: d.status,
          mode: d.mode,
          gpuModel: d.gpuModel,
          installStatus: d.installStatus,
          installDone:
            d.installSteps && d.installSteps.length > 0
              ? d.installSteps.filter((s) => s.status === "pass" || s.status === "skipped").length
              : null,
          installTotal: d.installSteps && d.installSteps.length > 0 ? d.installSteps.length : null,
          registrationState: d.registrationState,
          registeredUid: d.registeredUid,
          restartedAfterRegistration: d.restartedAfterRegistration,
        })),
        verifiedUid: reg.verifiedUid,
        verifiedNetuid: reg.netuid,
      }),
    [journey, hosts, deployments, reg.verifiedUid, reg.netuid]
  );
  const rental = progress.rental;

  // Open the wizard bound to the rental deployment when one exists.
  const openWalletGuide = async () => {
    if (rental) {
      try {
        const res = await fetch(`/api/deployments/${rental.deploymentId}/registration`, {
          cache: "no-store",
        });
        const j = await res.json();
        if (res.ok && j.wizard) setWalletCtx(j.wizard as RegistrationWizardContext);
      } catch {
        /* fall back to the unbound wizard */
      }
    } else {
      setWalletCtx(null);
    }
    setWalletOpen(true);
  };

  const s1 = progress.s1;
  const s2 = progress.s2;
  const s3 = progress.s3;
  const s4 = progress.s4;
  const s5 = progress.s5;
  const current = progress.current;

  const cells = [
    {
      n: 1,
      title: "Choose subnet",
      done: s1,
      active: current === 1,
      body: journey ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/5 text-[10px] text-primary">
            SN{journey.netuid} · {journey.name}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            needs {journey.minVramGb > 0 ? `≥ ${journey.minVramGb} GB VRAM` : "any GPU"}
          </span>
          <button
            className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={onClearSubnet}
          >
            <X className="h-3 w-3" /> clear
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Browse the live subnets — the engine pulls the winner&apos;s requirements.
        </p>
      ),
      cta: (
        <Button variant={s1 ? "outline" : "default"} size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={onPickSubnet}>
          <Pickaxe className="h-3 w-3" /> {s1 ? "Change subnet" : "Pick a subnet"}
        </Button>
      ),
    },
    {
      n: 2,
      title: "Get a GPU host",
      done: s2,
      active: current === 2,
      body: rental ? (
        <div className="space-y-0.5">
          <p className="text-[11px] font-medium text-foreground/80">
            {rental.minerName} <span className="font-normal text-muted-foreground">· {rental.gpuModel} ({rental.mode})</span>
          </p>
          <p className="text-[11px] text-muted-foreground">{rental.hint}</p>
        </div>
      ) : journey ? (
        <p className="text-[11px] text-muted-foreground">
          Rent <b className="text-foreground/80">{journey.recommendedGpu}</b> or ≥{" "}
          {journey.minVramGb} GB VRAM (RunPod / Vast / Lambda), or connect your own box.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Pick a subnet first — it decides which GPU to rent.
        </p>
      ),
      cta: (
        <div className="flex flex-wrap items-center gap-1.5">
          {onRent && (
            <Button
              size="sm"
              variant={s2 ? "outline" : "default"}
              className="h-7 gap-1 px-2 text-[11px]"
              onClick={onRent}
            >
              <Rocket className="h-3 w-3" /> Rent a GPU
            </Button>
          )}
          <Button
            size="sm"
            variant={s2 || onRent ? "outline" : "default"}
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={onAddHost}
          >
            <Server className="h-3 w-3" /> {s2 ? `Add host (${hosts.length} connected)` : "Add GPU host"}
          </Button>
        </div>
      ),
    },
    {
      n: 3,
      title: "Validate",
      done: s3,
      active: current === 3,
      body: rental ? (
        <div className="space-y-0.5">
          <p className="text-[11px] font-medium text-foreground/80">
            {rental.installStatus === "installed" || rental.status === "started"
              ? "Environment installed — docker/venv plan completed."
              : rental.installStatus === "running"
                ? `Installing — ${rental.installDone ?? 0}/${rental.installTotal ?? "?"} steps…`
                : rental.installStatus === "awaiting_wallet"
                  ? "Environment ready — wallet files gate."
                  : rental.status === "requested" || rental.status === "approved" || rental.status === "provisioning" || rental.status === "provisioned"
                    ? "GPU rented — press Advance to start the install."
                    : "Install pending."}
          </p>
          {primary && (
            <p className="text-[11px] text-muted-foreground">BYO: {primary.name} · {primary.status.replace("_", " ")}</p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {primary
            ? `Next: ${primary.name} · ${primary.status.replace("_", " ")} — 10-step environment pipeline.`
            : "Connect a host first — or rent a GPU above."}
        </p>
      ),
      cta: (
        <Button
          size="sm"
          variant={s3 ? "outline" : "default"}
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={!primary}
          onClick={() => primary && onValidate(primary.id)}
        >
          <ShieldCheck className="h-3 w-3" /> Run pipeline
        </Button>
      ),
    },
    {
      n: 4,
      title: "Deploy & mine",
      done: s4,
      active: current === 4,
      body: rental ? (
        <div className="space-y-0.5">
          <p className={cn("text-[11px] font-medium", rental.status === "started" ? "text-success" : "text-foreground/80")}>
            {rental.status === "started"
              ? "Miner running — awaiting registration."
              : rental.installStatus === "awaiting_wallet"
                ? "Wallet gate — confirm keys, then Advance launches."
                : "Launch pending the install."}
          </p>
          {primary && (
            <p className="text-[11px] text-muted-foreground">BYO: {primary.latestInstall?.status ?? "not deployed"}</p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {!journey
            ? "Pick a subnet first."
            : !s3
              ? "Validate the host first — the engine installs after that."
              : `Installs SN${journey.netuid} ${journey.name} requirements on the host and starts the miner.`}
        </p>
      ),
      cta: (
        <Button
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          disabled={!journey || !primary || primary.status !== "ready"}
          onClick={() => journey && primary && onDeploy(primary.id)}
        >
          <Rocket className="h-3 w-3" />
          {s4 ? "Deploy again / another host" : `Deploy SN${journey?.netuid ?? "?"} ${journey?.name ?? ""}`}
        </Button>
      ),
    },
    {
      n: 5,
      title: "Connect & register",
      done: s5,
      active: current === 5,
      body: rental?.registrationState === "registered" ? (
        <div className="space-y-0.5">
          <p className="text-[11px] font-medium text-success">
            UID {rental.registeredUid ?? "?"} on-chain — immunity tracked in UID Defense.
          </p>
          {!rental.restartedAfterRegistration && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              Restart the miner (deployment card) to re-announce its axon.
            </p>
          )}
        </div>
      ) : s5 ? (
        <p className="text-[11px] text-success">
          UID {reg.verifiedUid} verified on-chain — the UID Defense panel is
          tracking it.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {!journey
            ? "Pick a subnet first — the guide tailors every command to it."
            : "Create the wallet on your laptop, fund it, then register the hotkey to the subnet (burn → UID). Registration is the LAST step — it starts the immunity clock."}
        </p>
      ),
      cta: (
        <Button
          size="sm"
          variant={s5 ? "outline" : "default"}
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={openWalletGuide}
        >
          <KeyRound className="h-3 w-3" />
          {s5 ? "Open wallet guide" : "Start wallet setup"}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Card className="border-primary/20 bg-primary/[0.03]">
        <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-eyebrow text-muted-foreground">Mining journey — follow the steps</p>
          {journey && (
            <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
              <ShieldCheck className="h-3 w-3 text-primary" /> {journey.confidence} confidence
            </Badge>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {cells.map((c, i) => (
            <div key={c.n} className="relative">
              <div
                className={cn(
                  "flex h-full flex-col gap-2 rounded-md border p-3",
                  c.done
                    ? "border-success/30 bg-success/[0.04]"
                    : c.active
                      ? "border-primary/40 bg-background/60"
                      : "border-border/60 bg-background/30"
                )}
              >
                <div className="flex items-center gap-2">
                  <StepBubble n={c.n} done={c.done} active={c.active} />
                  <span className="text-sm font-semibold">{c.title}</span>
                  {i < cells.length - 1 && (
                    <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground/50" />
                  )}
                </div>
                {c.body}
                <div className="mt-auto">{c.cta}</div>
              </div>
            </div>
          ))}
        </div>
        </CardContent>
      </Card>
      <WalletRegistrationDialog
        open={walletOpen}
        onOpenChange={(o) => {
          setWalletOpen(o);
          if (!o) setWalletCtx(null);
        }}
        journey={journey}
        minerDeployed={s4}
        deployment={walletCtx}
      />
    </>
  );
}
