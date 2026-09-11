"use client";

// Subnet Requirements dialog — works for EVERY subnet, not just curated ones.
//
// Primary path : GET /api/devops/subnet-requirements?netuid=N — the profiler
//                pulls the subnet's REAL requirements from the chain identity +
//                its GitHub repo (README/requirements.txt/pyproject/Dockerfile/
//                repo tree). First pull takes a few seconds; cached 6h in DB.
// Fallback     : if the profiler fails and the subnet happens to be in the
//                curated catalog, render the static curated baseline instead.
// Never        : silently render nothing (the old `if (!req) return null` bug
//                that made Requirements appear broken for live-only subnets).

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Cpu,
  Terminal,
  Server,
  Network,
  Coins,
  Package,
  Zap,
  ExternalLink,
  Copy,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  FileWarning,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Subnet, MiningRequirements } from "@/lib/infranex/types";
import type { SubnetRequirementsProfile } from "@/lib/devops/subnet-requirements";

interface SubnetRequirementsDialogProps {
  subnet: Subnet | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartMining?: (s: Subnet) => void;
}

type FetchState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "loaded"; profile: SubnetRequirementsProfile; cached: boolean }
  | { phase: "error"; message: string };

export function SubnetRequirementsDialog({
  subnet,
  open,
  onOpenChange,
  onStartMining,
}: SubnetRequirementsDialogProps) {
  const { toast } = useToast();
  const [state, setState] = useState<FetchState>({ phase: "idle" });
  const [refreshing, setRefreshing] = useState(false);

  const netuid = subnet?.netuid;

  useEffect(() => {
    if (!open || netuid == null || netuid < 0) {
      setState({ phase: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000); // cold chain sync can be slow
    setState({ phase: "loading" });
    (async () => {
      try {
        const res = await fetch(
          `/api/devops/subnet-requirements?netuid=${netuid}`,
          { signal: controller.signal }
        );
        const j = (await res.json()) as
          | { profile: SubnetRequirementsProfile; cached: boolean }
          | { error: string };
        if (!res.ok || "error" in j) {
          setState({
            phase: "error",
            message: "error" in j ? j.error : `Profiler returned ${res.status}`,
          });
          return;
        }
        setState({ phase: "loaded", profile: j.profile, cached: j.cached });
      } catch (e) {
        if (controller.signal.aborted) return;
        setState({
          phase: "error",
          message: e instanceof Error ? e.message : "Profiler request failed",
        });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, netuid]);

  if (!subnet || !open) return null;

  const refresh = async () => {
    if (netuid == null) return;
    setRefreshing(true);
    try {
      const res = await fetch(
        `/api/devops/subnet-requirements?netuid=${netuid}&refresh=1`
      );
      const j = (await res.json()) as
        | { profile: SubnetRequirementsProfile; cached: boolean }
        | { error: string };
      if (res.ok && "profile" in j) {
        setState({ phase: "loaded", profile: j.profile, cached: j.cached });
        toast({ title: "Profile refreshed", description: `α${netuid} requirements re-pulled from chain + GitHub` });
      } else {
        toast({
          title: "Refresh failed",
          description: "error" in j ? j.error : `Profiler returned ${res.status}`,
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Refresh failed", description: "Network error", variant: "destructive" });
    } finally {
      setRefreshing(false);
    }
  };

  const copyCommand = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Miner command copied to clipboard" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto custom-scroll">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="mono text-[10px]">{subnet.symbol}</Badge>
            <DialogTitle className="text-display text-2xl">
              {subnet.name} — Mining Requirements
            </DialogTitle>
          </div>
          <DialogDescription>
            NetUID {subnet.netuid} · {subnet.category} · Pulled from the subnet&apos;s chain identity + GitHub repo
          </DialogDescription>
        </DialogHeader>

        {state.phase === "loading" && <LoadingState netuid={subnet.netuid} />}

        {state.phase === "loaded" && (
          <LiveProfileView
            profile={state.profile}
            cached={state.cached}
            subnet={subnet}
            refreshing={refreshing}
            onRefresh={refresh}
            onStartMining={onStartMining}
            onCopy={copyCommand}
          />
        )}

        {state.phase === "error" && (
          <ErrorState
            message={state.message}
            subnet={subnet}
            onRefresh={refresh}
            refreshing={refreshing}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingState({ netuid }: { netuid: number }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-4 flex items-start gap-3">
        <RefreshCw className="h-4 w-4 mt-0.5 animate-spin text-primary" />
        <div>
          <p className="text-sm font-medium">Profiling α{netuid} from chain + GitHub…</p>
          <p className="text-xs text-muted-foreground mt-1">
            First pull reads the subnet repo (README, requirements.txt, pyproject, Dockerfile, file tree)
            and takes a few seconds. The result is cached for 6 hours afterwards.
          </p>
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error / fallback state
// ---------------------------------------------------------------------------

function ErrorState({
  message,
  subnet,
  onRefresh,
  refreshing,
}: {
  message: string;
  subnet: Subnet;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const hasStatic = Boolean(subnet.miningRequirements);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Could not profile this subnet&apos;s repo</p>
            <p className="text-xs text-muted-foreground mt-1 break-words">{message}</p>
            <div className="flex items-center gap-2 mt-3">
              <Button size="sm" variant="outline" className="gap-2" onClick={onRefresh} disabled={refreshing}>
                <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                Retry live profile
              </Button>
              {subnet.githubUrl && (
                <Button size="sm" variant="ghost" className="gap-2" onClick={() => window.open(subnet.githubUrl!, "_blank")}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open repo manually
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      {hasStatic ? <StaticRequirementsView req={subnet.miningRequirements!} subnet={subnet} /> : (
        <p className="text-xs text-muted-foreground">
          No curated baseline exists for this subnet either — retry in a moment (GitHub or the chain
          snapshot may be temporarily unreachable).
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live profiler profile (primary)
// ---------------------------------------------------------------------------

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const map = {
    high: "border-success/40 text-success",
    medium: "border-amber-500/40 text-amber-500",
    low: "border-destructive/40 text-destructive",
  } as const;
  return (
    <Badge variant="outline" className={cn("text-[10px] gap-1", map[confidence])}>
      <ShieldCheck className="h-3 w-3" />
      {confidence} confidence
    </Badge>
  );
}

function Chip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <Badge variant="outline" className={cn("text-[10px]", mono && "mono")}>
      {children}
    </Badge>
  );
}

function LiveProfileView({
  profile,
  cached,
  subnet,
  refreshing,
  onRefresh,
  onStartMining,
  onCopy,
}: {
  profile: SubnetRequirementsProfile;
  cached: boolean;
  subnet: Subnet;
  refreshing: boolean;
  onRefresh: () => void;
  onStartMining?: (s: Subnet) => void;
  onCopy: (text: string) => void;
}) {
  const p = profile;
  return (
    <div className="space-y-4">
      {/* Provenance strip */}
      <div className="flex flex-wrap items-center gap-2">
        {p.sources.map((s) => (
          <Chip key={s}>{s === "github" ? "GitHub repo" : s === "chain" ? "On-chain identity" : "Classifier"}</Chip>
        ))}
        <ConfidenceBadge confidence={p.confidence} />
        <Chip>{cached ? "cached (6h TTL)" : "fresh pull"}</Chip>
        {p.fetchedAt && (
          <span className="text-[10px] text-muted-foreground">
            {new Date(p.fetchedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Notes / warnings */}
      {p.notes.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 space-y-1.5">
          {p.notes.map((n, i) => (
            <div key={i} className="flex items-start gap-2">
              <FileWarning className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-600 dark:text-amber-400">{n}</p>
            </div>
          ))}
        </div>
      )}

      {/* GPU Requirements */}
      <Section icon={<Cpu className="h-4 w-4 text-primary" />} title="GPU Requirements">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Spec label="Min VRAM" value={`${p.minVramGb} GB`} highlight={p.minVramGb >= 80} />
          <Spec label="Recommended GPU" value={p.recommendedGpu} />
          <Spec label="GPU Spec Source" value={GPU_SOURCE_LABEL[p.gpuSource]} />
        </div>
      </Section>

      {/* Runtime & Dependencies */}
      <Section icon={<Package className="h-4 w-4 text-primary" />} title="Runtime & Dependencies">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Spec label="Python" value={p.pythonVersion ?? "distro default"} mono />
          <Spec label="Min CUDA" value={p.cudaMinVersion ?? "n/a"} mono />
          <Spec label="Package Mgr" value={p.packageManager === "uv" ? "uv (workspace)" : "pip"} mono />
          <Spec label="Docker" value={p.dockerRequired ? p.dockerImage ?? "required" : "optional"} mono={p.dockerRequired} />
        </div>
        <div className="mt-3">
          <p className="text-[10px] text-muted-foreground mb-1.5">
            OS packages (apt) · {p.osPackages.length}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {p.osPackages.map((pkg) => <Chip key={pkg} mono>{pkg}</Chip>)}
          </div>
        </div>
        <div className="mt-3">
          <p className="text-[10px] text-muted-foreground mb-1.5">
            Python dependencies · {p.pipPackageCount} total
            {p.pipPackageCount > p.pipPackages.length ? ` (showing ${p.pipPackages.length})` : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {p.pipPackages.map((dep) => <Chip key={dep} mono>{dep}</Chip>)}
            {p.pipPackageCount === 0 && (
              <span className="text-xs text-muted-foreground">none declared in the repo</span>
            )}
          </div>
        </div>
        {p.gitDeps.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] text-muted-foreground mb-1.5">Git-installed deps</p>
            <div className="flex flex-wrap gap-1.5">
              {p.gitDeps.map((dep) => <Chip key={dep} mono>{dep}</Chip>)}
            </div>
          </div>
        )}
        {p.bittensorStack.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] text-muted-foreground mb-1.5">Bittensor stack</p>
            <div className="flex flex-wrap gap-1.5">
              {p.bittensorStack.map((dep) => <Chip key={dep} mono>{dep}</Chip>)}
            </div>
          </div>
        )}
      </Section>

      {/* Repo & Entrypoint */}
      <Section icon={<GitBranch className="h-4 w-4 text-primary" />} title="Repo & Entrypoint">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Spec label="Repo Branch" value={p.repoBranch} mono />
          <Spec label="Entrypoint" value={p.entrypoint ?? "neurons/miner.py (default)"} mono />
          <Spec label="Dockerfile" value={p.dockerfileFound ? "found in repo" : "not present"} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {p.repoUrl && (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => window.open(p.repoUrl!, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5" />
              GitHub repo
            </Button>
          )}
          {p.readmeUrl && (
            <Button size="sm" variant="ghost" className="gap-2" onClick={() => window.open(p.readmeUrl, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5" />
              README
            </Button>
          )}
          {p.requirementsUrl && (
            <Button size="sm" variant="ghost" className="gap-2" onClick={() => window.open(p.requirementsUrl, "_blank")}>
              <ExternalLink className="h-3.5 w-3.5" />
              requirements.txt
            </Button>
          )}
        </div>
      </Section>

      {/* Network Configuration */}
      <Section icon={<Network className="h-4 w-4 text-primary" />} title="Network Configuration">
        <div className="grid grid-cols-3 gap-3">
          <Spec label="Network" value={p.chainNetwork} mono />
          <Spec label="Axon Port" value={String(p.ports.axon)} mono />
          <Spec label="Prometheus Port" value={String(p.ports.prometheus)} mono />
        </div>
      </Section>

      {/* Miner Command */}
      <Section icon={<Terminal className="h-4 w-4 text-primary" />} title="Miner Command">
        <div className="relative">
          <pre className="overflow-x-auto rounded-md border bg-background/80 p-3 font-mono text-[11px] text-success custom-scroll">
            {p.minerCommandTemplate}
          </pre>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7"
            onClick={() => onCopy(p.minerCommandTemplate)}
            aria-label="Copy command"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-3">
          <p className="text-[10px] text-muted-foreground mb-1.5">Environment variables</p>
          <div className="space-y-1">
            {p.envKeys.map((env) => (
              <div key={env.name} className="flex items-center justify-between rounded-md border border-border/40 bg-background/60 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="mono text-xs font-medium">{env.name}</span>
                  {env.required && (
                    <Badge variant="outline" className="border-destructive/30 text-[9px] text-destructive">required</Badge>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground text-right">{env.description}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {onStartMining && (
          <Button className="gap-2" onClick={() => { onStartMining(subnet); onOpenChange(false); }}>
            <Zap className="h-4 w-4" />
            Start mining
          </Button>
        )}
        <Button variant="outline" className="gap-2" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          Refresh profile
        </Button>
      </div>
    </div>
  );
}

const GPU_SOURCE_LABEL: Record<SubnetRequirementsProfile["gpuSource"], string> = {
  repo: "from repo README",
  classifier: "work-type classifier",
  "revenue-est": "revenue estimate",
  curated: "curated baseline",
};

// ---------------------------------------------------------------------------
// Curated static fallback (only when the profiler fails on a curated subnet)
// ---------------------------------------------------------------------------

function StaticRequirementsView({ req, subnet }: { req: MiningRequirements; subnet: Subnet }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Chip>curated catalog baseline</Chip>
        <span className="text-[10px] text-muted-foreground">not live-profiled — verify against the repo</span>
      </div>
      <Section icon={<Cpu className="h-4 w-4 text-primary" />} title="GPU Requirements">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Spec label="Min VRAM" value={`${req.gpu.minVramGb} GB`} highlight={req.gpu.minVramGb >= 80} />
          <Spec label="Recommended GPU" value={req.gpu.recommendedGpu} />
          <Spec label="GPU Count" value={String(req.gpu.gpuCount)} />
          <Spec label="Min CUDA Compute" value={req.gpu.minCudaComputeCapability} />
          <Spec label="CUDA Version" value={req.runtime.cudaVersion} />
          <Spec label="NVIDIA Runtime" value={req.runtime.nvidiaRuntimeRequired ? "Required" : "Optional"} />
        </div>
      </Section>
      <Section icon={<Server className="h-4 w-4 text-primary" />} title="Hardware Requirements">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Spec label="Min CPU Cores" value={String(req.hardware.minCpuCores)} />
          <Spec label="Min RAM" value={`${req.hardware.minRamGb} GB`} />
          <Spec label="Recommended RAM" value={`${req.hardware.recommendedRamGb} GB`} />
          <Spec label="Min Disk" value={`${req.hardware.minDiskGb} GB`} />
        </div>
      </Section>
      <Section icon={<Terminal className="h-4 w-4 text-primary" />} title="Miner Command">
        <pre className="overflow-x-auto rounded-md border bg-background/80 p-3 font-mono text-[11px] text-success custom-scroll">
          {req.miner.command}
        </pre>
      </Section>
      <Section icon={<Coins className="h-4 w-4 text-primary" />} title="Registration Requirements">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Spec label="Min Stake" value={`${req.registration.minStakeTao} TAO`} mono />
          <Spec label="Reg. Cost" value={`${req.registration.registrationCostTao} TAO`} mono />
          <Spec label="Tempo" value={String(req.registration.tempo)} mono />
          <Spec label="Max Reg/Block" value={String(req.registration.maxRegistrationsPerBlock)} />
        </div>
      </Section>
      <p className="text-xs text-muted-foreground">
        To mine <strong>{subnet.name}</strong> (α{subnet.netuid}), you need a GPU with{" "}
        <span className="font-semibold text-primary">{req.gpu.minVramGb}GB VRAM</span> ({req.gpu.recommendedGpu}),
        running <span className="mono">Python {req.runtime.pythonVersion}</span> + <span className="mono">CUDA {req.runtime.cudaVersion}</span>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        {icon}
        <h3 className="text-display text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Spec({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/60 p-2.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm font-medium break-words", mono && "mono", highlight && "text-primary")}>
        {value}
      </p>
    </div>
  );
}
