"use client";

// ---------------------------------------------------------------------------
// DevOps Engine — Deploy-subnet wizard.
//
// Stage 1  Pick a subnet → PULL ITS REQUIREMENTS (chain + GitHub repo:
//          GPU/VRAM, OS packages, python version, pip deps, CUDA, entrypoint)
// Stage 2  Wallet names → BUILD INSTALL PLAN (9 steps, commands preview)
// Stage 3  STEP RUNNER — execute each step on the host; wallet step is a
//          manual gate (your keys), miner launch is approval-gated.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CloudDownload,
  Cpu,
  ExternalLink,
  GitBranch,
  Github,
  Hand,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Terminal,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDeploySubnetOptions,
  useHostInstall,
  useRunInstallStep,
  useStageInstall,
  useStopInstall,
  useSubnetRequirements,
  type InstallStepDto,
  type SubnetRequirementsProfile,
} from "@/lib/devops/use-devops";

const SOURCE_LABEL = {
  chain: "CHAIN",
  github: "GITHUB REPO",
  curated: "CLASSIFIER",
} as const;

function ConfidenceBadge({ level }: { level: SubnetRequirementsProfile["confidence"] }) {
  const cls =
    level === "high"
      ? "text-success border-success/40 bg-success/10"
      : level === "medium"
        ? "text-warning border-warning/40 bg-warning/10"
        : "text-muted-foreground border-border bg-muted/30";
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", cls)}>
      <ShieldCheck className="h-3 w-3" /> {level} confidence
    </Badge>
  );
}

function ProfileCard({ profile }: { profile: SubnetRequirementsProfile }) {
  const pipShown = profile.pipPackages.slice(0, 12);
  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          SN{profile.netuid} · {profile.subnetName}
        </span>
        {profile.category && (
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {profile.category}
          </Badge>
        )}
        <ConfidenceBadge level={profile.confidence} />
        <span className="ml-auto flex gap-1">
          {profile.sources.map((s) => (
            <Badge key={s} variant="outline" className="text-[9px] text-muted-foreground">
              {SOURCE_LABEL[s]}
            </Badge>
          ))}
        </span>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <p className="flex items-center gap-1.5">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            <b>GPU:</b> {profile.minVramGb > 0 ? `${profile.recommendedGpu} · ≥ ${profile.minVramGb} GB VRAM` : "CPU-friendly workload"}
            <span className="ml-1 text-[10px] text-muted-foreground">({profile.gpuSource})</span>
          </span>
        </p>
        <p className="flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            <b>Python:</b> {profile.pythonVersion ?? "distro default"} · <b>pip deps:</b>{" "}
            {profile.pipPackageCount || "bittensor baseline"}
          </span>
        </p>
        <p className="flex items-center gap-1.5">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            <b>CUDA:</b> {profile.cudaMinVersion ?? "any (≥ 12.0 pipeline default)"} ·{" "}
            <b>OS pkgs:</b> {profile.osPackages.length}
          </span>
        </p>
        <p className="flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">
            <b>Entrypoint:</b> {profile.entrypoint ?? "neurons/miner.py (default)"}
          </span>
        </p>
      </div>

      {profile.repoUrl ? (
        <p className="flex items-center gap-1.5 text-xs">
          <Github className="h-3.5 w-3.5 shrink-0 text-primary" />
          <a
            href={profile.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate text-primary underline-offset-2 hover:underline"
          >
            {profile.repoUrl.replace("https://github.com/", "")}
          </a>
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </p>
      ) : (
        <p className="text-xs text-warning">
          No GitHub repo linked on-chain — installing the bittensor baseline stack.
        </p>
      )}

      {pipShown.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {pipShown.map((p) => (
            <Badge key={p} variant="outline" className="font-mono text-[9px] text-muted-foreground">
              {p}
            </Badge>
          ))}
          {profile.pipPackageCount > pipShown.length && (
            <Badge variant="outline" className="text-[9px] text-muted-foreground">
              +{profile.pipPackageCount - pipShown.length} more
            </Badge>
          )}
        </div>
      )}

      <div className="rounded bg-background/60 p-2 font-mono text-[10px] leading-snug text-muted-foreground">
        $ {profile.minerCommandTemplate}
      </div>

      {profile.notes.length > 0 && (
        <ul className="space-y-0.5 text-[10px] text-muted-foreground">
          {profile.notes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: InstallStepDto["status"] }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  if (status === "fail") return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  if (status === "running") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />;
  if (status === "skipped") return <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />;
  return <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground/50" />;
}

const GATE_HINT: Record<InstallStepDto["gate"], string> = {
  auto: "runs automatically",
  manual: "manual gate — confirm your wallet files",
  approval: "approval gate — starts the real workload",
};

export function DeploySubnetDialog({
  hostId,
  hostName,
  open,
  onOpenChange,
}: {
  hostId: string;
  hostName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [explicitStage, setExplicitStage] = useState<"pick" | "plan" | "run" | null>(null);
  const [dismissedInstallId, setDismissedInstallId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedNetuid, setSelectedNetuid] = useState<number | null>(null);
  const [pullFor, setPullFor] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [wallet, setWallet] = useState("default");
  const [hotkey, setHotkey] = useState("miner");
  const [error, setError] = useState<string | null>(null);

  const options = useDeploySubnetOptions();
  const requirements = useSubnetRequirements(pullFor, refreshKey > 0);
  const installQ = useHostInstall(open ? hostId : null);
  const stage_ = useStageInstall(hostId);
  const runStep = useRunInstallStep(hostId);
  const stop = useStopInstall(hostId);

  const install = installQ.data?.install ?? null;

  // Stage is derived: an existing live install opens straight into the runner,
  // unless the user explicitly navigates (New deployment / Continue / Build).
  const LIVE_STATUSES = ["staged", "running", "waiting_approval", "deployed", "failed"];
  const stage: "pick" | "plan" | "run" =
    explicitStage ??
    (install && install.id !== dismissedInstallId && LIVE_STATUSES.includes(install.status)
      ? "run"
      : "pick");

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

  const profile = requirements.data?.profile ?? null;
  const selected = (options.data ?? []).find((r) => r.netuid === selectedNetuid) ?? null;

  const nextStep = install?.steps.find((s) => s.status === "pending" || s.status === "fail");

  const reset = () => {
    setExplicitStage("pick");
    setDismissedInstallId(install?.id ?? null);
    setSelectedNetuid(null);
    setPullFor(null);
    setRefreshKey(0);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-4 w-4 text-primary" />
            Deploy subnet to {hostName}
          </DialogTitle>
          <DialogDescription>
            The engine pulls this subnet&apos;s real requirements (GPU, software, repo) and
            installs them on the host — step by step, with your approval before anything heavy runs.
          </DialogDescription>
        </DialogHeader>

        {/* Stage indicator */}
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {(["pick", "plan", "run"] as const).map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 font-mono uppercase",
                  stage === s ? "bg-primary/10 text-primary" : "bg-muted/30"
                )}
              >
                {i + 1}·{s === "pick" ? "requirements" : s === "plan" ? "wallet" : "install"}
              </span>
            </span>
          ))}
          {stage !== "pick" && (
            <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-[10px]" onClick={reset}>
              <RefreshCw className="mr-1 h-3 w-3" /> New deployment
            </Button>
          )}
        </div>

        {/* ---------------- Stage 1 — pick + pull requirements ---------------- */}
        {stage === "pick" && (
          <div className="space-y-3">
            {install && ["staged", "running", "waiting_approval", "deployed", "failed"].includes(install.status) ? (
              <p className="rounded-md border border-border/60 bg-background/40 p-2 text-xs text-muted-foreground">
                This host already has an install job (SN{install.netuid} · {install.status}).{" "}
                <button className="text-primary underline" onClick={() => setExplicitStage("run")}>
                  Open it
                </button>{" "}
                or start a new one below (the old job is retired).
              </p>
            ) : null}

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
              <Button
                className="w-full gap-2"
                onClick={() => {
                  setExplicitStage("plan");
                  setError(null);
                }}
              >
                Continue to wallet <ChevronRight className="h-4 w-4" />
              </Button>
            )}

            {profile && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 text-xs"
                disabled={requirements.isFetching}
                onClick={() => setRefreshKey((k) => k + 1)}
              >
                <RefreshCw className={cn("h-3 w-3", requirements.isFetching && "animate-spin")} />
                Re-pull from GitHub (bypass cache)
              </Button>
            )}
          </div>
        )}

        {/* ---------------- Stage 2 — wallet + build plan ---------------- */}
        {stage === "plan" && profile && (
          <div className="space-y-3">
            <ProfileCard profile={profile} />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Wallet (coldkey) name</Label>
                <Input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="default" />
              </div>
              <div className="space-y-1">
                <Label>Hotkey name</Label>
                <Input value={hotkey} onChange={(e) => setHotkey(e.target.value)} placeholder="miner" />
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button
              className="w-full gap-2"
              disabled={stage_.isPending}
              onClick={() =>
                stage_.mutate(
                  { netuid: profile.netuid, walletName: wallet.trim(), hotkeyName: hotkey.trim() },
                  {
                    onSuccess: () => setExplicitStage("run"),
                    onError: (e) => setError(e.message),
                  }
                )
              }
            >
              {stage_.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Build install plan (9 steps)
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Nothing is installed yet — the plan is staged and you approve each step.
            </p>
          </div>
        )}

        {/* ---------------- Stage 3 — step runner ---------------- */}
        {stage === "run" && install && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px]",
                  install.status === "deployed"
                    ? "border-success/40 bg-success/10 text-success"
                    : install.status === "failed"
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : install.status === "waiting_approval"
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-primary/40 bg-primary/10 text-primary"
                )}
              >
                {install.status.replace("_", " ")}
              </Badge>
              <span className="font-medium">
                SN{install.netuid} · {install.subnetName}
              </span>
              <span className="text-muted-foreground">
                wallet {install.walletName}/{install.hotkeyName}
              </span>
              {["deployed", "failed", "waiting_approval"].includes(install.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-6 gap-1 px-2 text-[10px]"
                  disabled={stop.isPending}
                  onClick={() => stop.mutate()}
                >
                  <Square className="h-3 w-3" /> Stop miner
                </Button>
              )}
            </div>

            {runStep.isError && (
              <p className="text-xs text-destructive">
                Step error: {(runStep.error as Error).message}
              </p>
            )}

            {install.steps.map((s) => {
              // Relaunch mode: after a safety stop, the Launch step restarts the miner.
              const relaunchMode = install.status === "stopped";
              const actionable = relaunchMode
                ? s.gate === "approval"
                : nextStep?.id === s.id ||
                  (s.status === "fail" && !nextStep) ||
                  (s.status === "pending" &&
                    s.gate === "manual" &&
                    !install.steps.some((x) => x.status === "pending" && x.idx < s.idx));
              const canRun = actionable && !runStep.isPending;
              return (
                <div
                  key={s.id}
                  className={cn(
                    "rounded-md border p-2.5",
                    s.status === "fail"
                      ? "border-destructive/40 bg-destructive/5"
                      : s.status === "pass"
                        ? "border-success/30 bg-success/5"
                        : s.status === "running"
                          ? "border-primary/40 bg-primary/5"
                          : "border-border/60"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <StepIcon status={s.status} />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {String(s.idx).padStart(2, "0")}
                    </span>
                    <span className="flex-1 text-sm font-medium">{s.title}</span>
                    {s.gate !== "auto" && s.status === "pending" && (
                      <Badge variant="outline" className="gap-1 text-[9px] text-warning">
                        {s.gate === "manual" ? <Hand className="h-2.5 w-2.5" /> : null} {s.gate}
                      </Badge>
                    )}
                    {s.durationMs > 0 && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {(s.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    {s.status === "fail" && s.gate === "manual" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 px-2 text-[11px]"
                        disabled={!canRun}
                        onClick={() => runStep.mutate({ stepId: s.id, action: "override" })}
                      >
                        Files are in place — continue
                      </Button>
                    )}
                    {actionable && !(s.status === "fail" && s.gate === "manual") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 px-2 text-[11px]"
                        disabled={!canRun}
                        onClick={() => runStep.mutate({ stepId: s.id })}
                      >
                        {runStep.isPending && nextStep?.id === s.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        {s.status === "fail" ? "Retry" : s.gate === "approval" ? "Launch" : "Run"}
                      </Button>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{s.description}</p>
                  {s.commands.length > 0 && s.status !== "pass" && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-muted-foreground">
                        commands
                      </summary>
                      <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[10px] text-muted-foreground">
                        {s.commands.map((c) => `$ ${c}`).join("\n")}
                      </pre>
                    </details>
                  )}
                  {s.output && (
                    <pre className="mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] leading-snug text-muted-foreground">
                      {s.output}
                    </pre>
                  )}
                  {s.status === "fail" && s.remediation && (
                    <p className="mt-1 text-[11px] text-warning">{s.remediation}</p>
                  )}
                  {s.gate === "approval" && s.status === "pending" && (
                    <p className="mt-1 text-[10px] text-warning">
                      Approval gate — this starts the real miner workload on the host.
                    </p>
                  )}
                </div>
              );
            })}

            {install.status === "deployed" && (
              <p className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 p-2 text-xs text-success">
                <CheckCircle2 className="h-4 w-4" />
                Miner deployed and running as a systemd service (auto-restart on crash).
              </p>
            )}
            {gateHintFor(install.status) && (
              <p className="text-[10px] text-muted-foreground">{gateHintFor(install.status)}</p>
            )}
          </div>
        )}

        {stage === "run" && !install && (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading install job…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function gateHintFor(status: string): string | null {
  if (status === "waiting_approval")
    return "Waiting for your approval — the Launch step starts the miner as a systemd service.";
  if (status === "failed")
    return "A step failed — fix what it says, then hit Retry on the red step.";
  if (status === "deployed")
    return "Uptime is everything in Bittensor — keep the machine online and watch the logs.";
  if (status === "stopped") return "The miner service is stopped on the host.";
  return null;
}
