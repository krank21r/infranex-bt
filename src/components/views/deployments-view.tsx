"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Rocket,
  Plus,
  Play,
  XCircle,
  Trash2,
  Terminal,
  CheckCircle2,
  Loader2,
  Circle,
  X,
  Server,
  Cpu,
  DollarSign,
  TrendingUp,
  Wrench,
  KeyRound,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { cn, formatCurrency, formatRelativeTime } from "@/lib/utils";
import {
  useDeployments,
  useTickDeployment,
  useTerminateDeployment,
  useDeleteDeployment,
  useRegistrationAction,
  useRegistrationWatcher,
  type DeploymentRecord,
  type RegistrationWizardContext,
} from "@/lib/infranex/use-deployments";
import { DeployWizard } from "@/components/deployments/deploy-wizard";
import { DevOpsEngineSection } from "@/components/devops/devops-console";
import { WalletRegistrationDialog } from "@/components/devops/wallet-registration-dialog";

const SS58_RE = /^5[1-9A-HJ-NP-Za-km-z]{47}$/;

export function DeploymentsView() {
  const { data: deployments, isLoading } = useDeployments();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wizardCtx, setWizardCtx] = useState<RegistrationWizardContext | null>(null);

  const active = deployments?.filter(
    (d) => d.status !== "terminated" && d.status !== "failed"
  ) ?? [];
  const terminal = deployments?.filter(
    (d) => d.status === "terminated" || d.status === "failed"
  ) ?? [];

  const selected = deployments?.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-eyebrow text-muted-foreground">
            Section · 06 · <span className="text-primary">Step 3 — onboard, validate &amp; deploy</span>
          </p>
          <h1 className="animate-rise text-display text-3xl font-bold tracking-tight md:text-4xl">
            Deployments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One guided flow: choose a subnet → check its required GPU → rent from a provider →
            requirements install automatically → add the hotkey &amp; register last. The DevOps
            Engine below manages YOUR OWN GPU hosts; rental deployments appear as cards here.
          </p>
        </div>
        <Button className="gap-2 self-start sm:self-end" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Deploy a miner
        </Button>
      </header>

      {/* --- DevOps Engine: real GPU host onboarding + 10-step pipeline --- */}
      <DevOpsEngineSection />

      <Separator />

      {isLoading ? (
        <Card className="border-border/60 bg-card/40 backdrop-blur-sm">
          <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading deployments…</span>
          </CardContent>
        </Card>
      ) : deployments && deployments.length === 0 ? (
        <Card className="border-dashed border-border/60 bg-card/20">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Rocket className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-display text-lg font-medium">No deployments yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create your first deployment to provision a GPU and launch a miner.
              </p>
            </div>
            <Button className="mt-2 gap-2" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Deploy a miner
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Active deployments */}
          {active.length > 0 && (
            <section className="space-y-3">
              <p className="text-eyebrow text-muted-foreground">
                Active · {active.length}
              </p>
              <div className="grid gap-3">
                {active.map((d) => (
                  <DeploymentCard
                    key={d.id}
                    deployment={d}
                    onSelect={() => setSelectedId(d.id)}
                    isSelected={selectedId === d.id}
                    onOpenWizard={setWizardCtx}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Terminal deployments */}
          {terminal.length > 0 && (
            <section className="space-y-3">
              <p className="text-eyebrow text-muted-foreground">
                Terminated · {terminal.length}
              </p>
              <div className="grid gap-3 opacity-60">
                {terminal.map((d) => (
                  <DeploymentCard
                    key={d.id}
                    deployment={d}
                    onSelect={() => setSelectedId(d.id)}
                    isSelected={selectedId === d.id}
                    onOpenWizard={setWizardCtx}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Detail panel */}
          {selected && (
            <DeploymentDetail deployment={selected} onClose={() => setSelectedId(null)} />
          )}
        </>
      )}

      <DeployWizard
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => setSelectedId(id)}
      />

      {/* Phase 2 hand-off: the registration wizard bound to a running deployment */}
      <WalletRegistrationDialog
        open={!!wizardCtx}
        onOpenChange={(o) => {
          if (!o) setWizardCtx(null);
        }}
        journey={null}
        minerDeployed
        deployment={wizardCtx}
      />
    </div>
  );
}

function DeploymentCard({
  deployment: d,
  onSelect,
  isSelected,
  onOpenWizard,
}: {
  deployment: DeploymentRecord;
  onSelect: () => void;
  isSelected: boolean;
  onOpenWizard: (ctx: RegistrationWizardContext) => void;
}) {
  const tickMut = useTickDeployment();
  const termMut = useTerminateDeployment();
  const delMut = useDeleteDeployment();
  const regAction = useRegistrationAction();
  const qc = useQueryClient();
  const [devopsNote, setDevopsNote] = useState<string | null>(null);
  const [devopsBusy, setDevopsBusy] = useState(false);
  const [wizardBusy, setWizardBusy] = useState(false);

  const isStarted = d.status === "started";
  const hasHotkey = SS58_RE.test(d.hotkey ?? "");

  // Phase 2 background watcher: for a STARTED deployment with a plausible
  // hotkey, poll the registration check every 45 s (server-throttled).
  const regWatch = useRegistrationWatcher(d.id, isStarted && hasHotkey);
  useEffect(() => {
    if (regWatch.data?.changed) {
      qc.invalidateQueries({ queryKey: ["deployments"] });
    }
  }, [regWatch.data?.changed, regWatch.data?.checkedAt, qc]);

  // Open the wizard pre-bound to THIS deployment (fetch its hand-off context).
  const openWizard = async () => {
    setWizardBusy(true);
    try {
      const res = await fetch(`/api/deployments/${d.id}/registration`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && j.wizard) onOpenWizard(j.wizard as RegistrationWizardContext);
      else setDevopsNote(j?.error ?? "Could not load the wizard context");
    } catch {
      setDevopsNote("Could not reach the registration API");
    } finally {
      setWizardBusy(false);
    }
  };

  const restartAfterReg = () => regAction.mutate({ id: d.id, action: "restart" });

  const registerToDevOps = async () => {
    setDevopsBusy(true);
    setDevopsNote(null);
    try {
      const res = await fetch(`/api/deployments/${d.id}/to-devops`, { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
      setDevopsNote(`Registered as host ${String(j.hostName ?? j.hostId)} — run validation in DevOps.`);
    } catch (e) {
      setDevopsNote(e instanceof Error ? e.message : "Register failed");
    } finally {
      setDevopsBusy(false);
    }
  };

  const isTerminal = d.status === "terminated" || d.status === "failed";
  const isInProgress = !isTerminal && d.status !== "started";

  const statusColor =
    d.status === "started"
      ? "bg-success/10 text-success"
      : isTerminal
        ? "bg-muted/50 text-muted-foreground"
        : "bg-primary/10 text-primary";

  return (
    <Card
      className={cn(
        "border-border/60 bg-card/40 backdrop-blur-sm transition-all",
        isSelected && "border-primary/40",
        !isTerminal && "hover:border-primary/30"
      )}
    >
      <CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex flex-col items-center gap-1 pt-1">
              <span className={cn("pulse-dot", isStarted ? "text-success" : isInProgress ? "text-primary" : "text-muted-foreground")} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{d.minerName}</p>
                <Badge variant="outline" className="mono text-[10px]">α{d.netuid}</Badge>
                <Badge variant="outline" className="text-[10px]">{d.subnetName}</Badge>
                <span className={cn("badge-status capitalize", statusColor)}>{d.status}</span>
                <Badge variant="outline" className={cn("text-[9px]", d.mode === "runpod" ? "border-primary/30 text-primary" : "text-muted-foreground")}>
                  {d.mode}
                </Badge>
                {/* Phase 2: registration lifecycle chip */}
                {isStarted && d.registrationState === "registered" && (
                  <Badge variant="outline" className="gap-1 border-success/40 text-[10px] text-success">
                    <ShieldCheck className="h-3 w-3" />
                    UID {d.registeredUid ?? "?"}
                  </Badge>
                )}
                {isStarted && d.registrationState === "unregistered" && (
                  <Badge variant="outline" className="gap-1 border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400">
                    <KeyRound className="h-3 w-3" />
                    unregistered
                  </Badge>
                )}
                {isStarted && d.registrationState === null && (
                  <Badge variant="outline" className={cn("gap-1 text-[10px]", hasHotkey ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                    <KeyRound className="h-3 w-3" />
                    {hasHotkey ? "registration unverified" : "no hotkey"}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {d.gpuModel} · {d.provider}
                {d.providerPodId && <span className="mono"> · pod {d.providerPodId.slice(0, 12)}</span>}
                {" · "}created {formatRelativeTime(new Date(d.createdAt))}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Cost/mo</p>
              <p className="tabular text-sm font-medium">{formatCurrency(d.monthlyCost)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground">Rev/mo</p>
              <p className="tabular text-sm font-medium text-success">{formatCurrency(d.estimatedRevenue)}</p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Progress</span>
            <span className="tabular">{d.progress}%</span>
          </div>
          <Progress
            value={d.progress}
            className="mt-1 h-1"
            indicatorClassName={cn(
              isStarted ? "bg-success" : isTerminal ? "bg-muted-foreground" : "bg-primary"
            )}
          />
        </div>

        {/* Step indicators */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          {d.steps.map((s) => {
            const Icon =
              s.status === "done" ? CheckCircle2
              : s.status === "running" ? Loader2
              : s.status === "failed" ? XCircle
              : Circle;
            return (
              <div key={s.name} className="flex items-center gap-1 text-[10px]">
                <Icon
                  className={cn(
                    "h-3 w-3",
                    s.status === "done" ? "text-success"
                    : s.status === "running" ? "animate-spin text-primary"
                    : s.status === "failed" ? "text-destructive"
                    : "text-muted-foreground/40"
                  )}
                />
                <span className={cn(s.status === "pending" ? "text-muted-foreground/60" : "text-foreground/80")}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <Separator className="my-3" />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onSelect}>
            <Terminal className="h-3.5 w-3.5" />
            View logs
          </Button>
          {isInProgress && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => tickMut.mutate(d.id)}
              disabled={tickMut.isPending}
            >
              <Play className="h-3.5 w-3.5" />
              {tickMut.isPending
                ? "Advancing…"
                : d.installStatus === "failed"
                  ? "Retry install"
                  : d.installStatus === "running"
                    ? "Installing…"
                    : "Advance step"}
            </Button>
          )}
          {isStarted && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={openWizard}
              disabled={wizardBusy}
            >
              {wizardBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              {d.registrationState === "registered" ? "Wallet & registration" : "Connect & register"}
            </Button>
          )}
          {isStarted && d.registrationState === "registered" && !d.restartedAfterRegistration && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-success/40 text-success hover:text-success"
              onClick={restartAfterReg}
              disabled={regAction.isPending}
            >
              {regAction.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
              {regAction.isPending ? "Restarting…" : "Restart miner (approval)"}
            </Button>
          )}
          {d.mode === "runpod" && !isTerminal && d.providerPodId && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={registerToDevOps}
              disabled={devopsBusy}
            >
              {devopsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
              Register to DevOps
            </Button>
          )}
          {!isTerminal && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => termMut.mutate(d.id)}
              disabled={termMut.isPending}
            >
              <XCircle className="h-3.5 w-3.5" />
              {termMut.isPending ? "Terminating…" : "Terminate"}
            </Button>
          )}
          {isTerminal && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => delMut.mutate(d.id)}
              disabled={delMut.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>
        {regAction.error && (
          <p className="mt-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {regAction.error instanceof Error ? regAction.error.message : "Registration action failed"}
          </p>
        )}
        {devopsNote && (
          <p className="mt-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-primary/90">
            {devopsNote}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DeploymentDetail({
  deployment: d,
  onClose,
}: {
  deployment: DeploymentRecord;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"logs" | "config">("logs");
  const cfg = d.config;

  return (
    <Card className="border-primary/30 bg-card/40">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <p className="text-eyebrow text-muted-foreground">Deployment detail</p>
          <CardTitle className="text-display flex items-center gap-2 text-xl">
            <Rocket className="h-4 w-4 text-primary" />
            {d.minerName}
          </CardTitle>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-lg border bg-card/30 p-1 w-fit">
          <button
            onClick={() => setTab("logs")}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-colors",
              tab === "logs" ? "bg-primary/10 text-primary" : "text-muted-foreground"
            )}
          >
            <Terminal className="mr-1.5 inline h-3 w-3" />
            Step logs
          </button>
          <button
            onClick={() => setTab("config")}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-colors",
              tab === "config" ? "bg-primary/10 text-primary" : "text-muted-foreground"
            )}
          >
            <Server className="mr-1.5 inline h-3 w-3" />
            Deployment config
          </button>
        </div>

        {tab === "logs" && (
          <div className="space-y-3">
            {d.steps.map((s) => (
              <div key={s.name} className="rounded-lg border border-border/40 bg-background/60 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {s.status === "done" ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : s.status === "running" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : s.status === "failed" ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/40" />
                    )}
                    <span className="text-sm font-medium">{s.label}</span>
                  </div>
                  <Badge variant="outline" className={cn(
                    "text-[10px] capitalize",
                    s.status === "done" && "border-success/30 text-success",
                    s.status === "running" && "border-primary/30 text-primary",
                    s.status === "failed" && "border-destructive/30 text-destructive"
                  )}>
                    {s.status}
                  </Badge>
                </div>
                {s.output.length > 0 && (
                  <pre className="mt-2 overflow-x-auto rounded bg-background/80 p-2 font-mono text-[11px] text-muted-foreground custom-scroll">
                    {s.output.join("\n")}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === "config" && cfg && (
          <div className="space-y-4">
            {/* Subnet + GPU summary */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/40 bg-background/60 p-3">
                <p className="text-eyebrow text-muted-foreground mb-2">Subnet</p>
                <p className="font-medium">{cfg.subnet.name} <span className="mono text-xs text-muted-foreground">α{cfg.subnet.netuid}</span></p>
                <p className="text-xs text-muted-foreground">{cfg.subnet.category} · min {cfg.subnet.minVramGb}GB</p>
              </div>
              <div className="rounded-lg border border-border/40 bg-background/60 p-3">
                <p className="text-eyebrow text-muted-foreground mb-2">GPU</p>
                <p className="font-medium">{cfg.gpu.model}</p>
                <p className="text-xs text-muted-foreground">{cfg.gpu.provider} · {cfg.gpu.vramGb}GB · {cfg.gpu.region}</p>
              </div>
            </div>

            {/* Docker config */}
            <div className="rounded-lg border border-border/40 bg-background/60 p-3">
              <p className="text-eyebrow text-muted-foreground mb-2 flex items-center gap-1.5">
                <Cpu className="h-3 w-3" /> Docker configuration
              </p>
              <div className="space-y-2 text-xs">
                <ConfigRow label="Image" value={cfg.docker.imageName} mono />
                <ConfigRow label="Runtime" value={cfg.docker.runtime} mono />
                <ConfigRow label="Ports" value={cfg.docker.ports.join(", ")} mono />
                <ConfigRow label="Min memory" value={`${cfg.docker.minMemoryGb} GB`} mono />
                <ConfigRow label="Min vCPU" value={String(cfg.docker.minVcpuCount)} mono />
                <ConfigRow label="Disk" value={`${cfg.docker.diskGb} GB`} mono />
              </div>
              <Separator className="my-2" />
              <p className="text-[10px] text-muted-foreground mb-1">Miner command</p>
              <pre className="overflow-x-auto rounded bg-background/80 p-2 font-mono text-[10px] text-success custom-scroll">
                {cfg.docker.command}
              </pre>
            </div>

            {/* Env vars */}
            <div className="rounded-lg border border-border/40 bg-background/60 p-3">
              <p className="text-eyebrow text-muted-foreground mb-2">Environment variables</p>
              <div className="space-y-1">
                {cfg.docker.envVars.map((e) => (
                  <div key={e.name} className="flex items-center justify-between text-xs">
                    <span className="mono font-medium">{e.name}</span>
                    <span className="mono text-muted-foreground">
                      {e.secret ? "••••••••" : e.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Requirements */}
            <div className="rounded-lg border border-border/40 bg-background/60 p-3">
              <p className="text-eyebrow text-muted-foreground mb-2">Requirements</p>
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <ConfigRow label="Python" value={cfg.requirements.pythonVersion} mono />
                <ConfigRow label="CUDA" value={cfg.requirements.cudaVersion} mono />
                <ConfigRow label="Docker" value={cfg.requirements.dockerRequired ? "required" : "no"} />
                <ConfigRow label="NVIDIA runtime" value={cfg.requirements.nvidiaRuntimeRequired ? "required" : "no"} />
              </div>
            </div>

            {/* Cost projection */}
            <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
              <p className="text-eyebrow text-primary mb-2 flex items-center gap-1.5">
                <DollarSign className="h-3 w-3" /> Cost projection
              </p>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground">Hourly</p>
                  <p className="tabular text-sm font-bold text-destructive">${cfg.cost.hourlyUsd.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Monthly</p>
                  <p className="tabular text-sm font-bold text-destructive">${cfg.cost.monthlyUsd}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Rev/mo</p>
                  <p className="tabular text-sm font-bold text-success">${cfg.cost.estimatedMonthlyRevenueUsd}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">ROI</p>
                  <p className={cn("tabular text-sm font-bold", cfg.cost.estimatedRoiPercent >= 0 ? "text-success" : "text-destructive")}>
                    {cfg.cost.estimatedRoiPercent >= 0 ? "+" : ""}{cfg.cost.estimatedRoiPercent}%
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-medium", mono && "mono")}>{value}</span>
    </div>
  );
}
