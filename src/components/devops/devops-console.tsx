"use client";

// ---------------------------------------------------------------------------
// DevOps Engine console — GPU host inventory + the 10-step onboarding wizard.
//
// Flow: add host (SSH or mock) → Run validation → the 10-step checklist runs
// for real (or against the scripted mock host) → failed steps expose one-click
// Fix buttons → re-validate → host marked READY for miner deployment.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Server,
  Plus,
  Play,
  Trash2,
  Wrench,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Loader2,
  Cpu,
  HardDrive,
  Rocket,
  Terminal,
  HelpCircle,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDevopsHosts,
  useHostDetail,
  useCreateHost,
  useDeleteHost,
  useValidateHost,
  useFixStep,
  type DevopsHost,
  type HostCheckRow,
} from "@/lib/devops/use-devops";
import { DeploySubnetDialog } from "./deploy-subnet-dialog";
import {
  MiningJourney,
  PickSubnetDialog,
  saveJourney,
  useJourney,
  type JourneySubnet,
} from "./mining-journey";

// Per-provider cheatsheet for the add-host dialog — answers "where do I find
// this?" for each field. Concrete, split-the-connect-string style guidance.
const PROVIDER_HELP = [
  {
    provider: "RunPod",
    how: "Pod → Connect → copy the SSH connection string, e.g. ssh root@ssh.runpod.io -p 18745 → fill Host ssh.runpod.io (or the direct IP), Port 18745, User root. Upload your public key under Settings → SSH Keys first and pick Private-key auth — RunPod does not accept passwords.",
  },
  {
    provider: "Vast.ai",
    how: "The instance card prints a ready command like ssh root@ssh5.vast.ai -p 12345 — split it into Host / Port / User. Keys are managed under Account → SSH keys (key auth only).",
  },
  {
    provider: "Lambda & other clouds",
    how: "Console → your instance → SSH tab shows the exact command. Typical shape: user ubuntu, port 22, and the PEM key you downloaded at launch.",
  },
  {
    provider: "Own server / colo",
    how: "Use the machine's public IP, the SSH user you normally log in with (root or your own account), and either your password or the full contents of ~/.ssh/id_ed25519 pasted into the key field.",
  },
] as const;

const HOST_STATUS = {
  ready: { label: "READY", cls: "text-success bg-success/10 border-success/30" },
  needs_fix: { label: "NEEDS FIX", cls: "text-warning bg-warning/10 border-warning/30" },
  validating: { label: "VALIDATING", cls: "text-primary bg-primary/10 border-primary/30" },
  failed: { label: "FAILED", cls: "text-destructive bg-destructive/10 border-destructive/30" },
  pending: { label: "PENDING", cls: "text-muted-foreground bg-muted/30 border-border" },
} as const;

function StepIcon({ status }: { status: HostCheckRow["status"] }) {
  if (status === "pass") return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
  if (status === "fixed") return <Wrench className="h-4 w-4 shrink-0 text-success" />;
  if (status === "fail") return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
  if (status === "running") return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />;
  return <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export function DevOpsEngineSection() {
  const { data, isLoading } = useDevopsHosts();
  const hosts = data?.hosts ?? [];
  const [wizardHostId, setWizardHostId] = useState<string | null>(null);
  const [deployHostId, setDeployHostId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const journey = useJourney();

  const confirmJourney = (j: JourneySubnet) => saveJourney(j);
  const clearJourney = () => saveJourney(null);

  const wizardHost = hosts.find((h) => h.id === wizardHostId) ?? null;
  const deployHost = hosts.find((h) => h.id === deployHostId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-display flex items-center gap-2 text-xl font-semibold">
            <Server className="h-5 w-5 text-primary" />
            DevOps Engine
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Step 3 of the mining journey — connect a GPU machine, run the 10-step
            pipeline, then deploy the subnet you chose: the engine pulls that
            subnet&apos;s requirements and installs them on the host.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add GPU host
        </Button>
      </div>

      {/* The guided 5-step journey: choose subnet → get GPU → validate → deploy → connect & register */}
      <MiningJourney
        hosts={hosts}
        journey={journey}
        onPickSubnet={() => setPickOpen(true)}
        onClearSubnet={clearJourney}
        onAddHost={() => setAddOpen(true)}
        onValidate={(id) => setWizardHostId(id)}
        onDeploy={(id) => setDeployHostId(id)}
      />

      {isLoading ? (
        <Card className="bg-card/40">
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading hosts…
          </CardContent>
        </Card>
      ) : hosts.length === 0 ? (
        <Card className="border-dashed bg-card/40">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Server className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No GPU hosts connected yet</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Add a real machine over SSH (BYO box, colo rig) or spin up the built-in
              mock host to try the full pipeline safely — it deliberately starts with
              Docker and the NVIDIA toolkit missing so you can watch the engine fix them.
            </p>
            <Button variant="outline" className="mt-1 gap-2" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add your first host
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {hosts.map((h) => (
            <HostCard
              key={h.id}
              host={h}
              onInspect={() => setWizardHostId(h.id)}
              onDeploy={() => setDeployHostId(h.id)}
            />
          ))}
        </div>
      )}

      <AddHostDialog open={addOpen} onOpenChange={setAddOpen} />
      <PickSubnetDialog
        open={pickOpen}
        onOpenChange={setPickOpen}
        onConfirm={confirmJourney}
      />
      {wizardHost && (
        <WizardDialog
          hostId={wizardHost.id}
          open={wizardHostId !== null}
          onOpenChange={(o) => !o && setWizardHostId(null)}
        />
      )}
      {deployHost && (
        <DeploySubnetDialog
          key={`${deployHost.id}:${journey?.netuid ?? "none"}`}
          hostId={deployHost.id}
          hostName={deployHost.name}
          open={deployHostId !== null}
          onOpenChange={(o) => !o && setDeployHostId(null)}
          preselectNetuid={journey?.netuid ?? null}
        />
      )}
    </div>
  );
}

function HostCard({
  host,
  onInspect,
  onDeploy,
}: {
  host: DevopsHost;
  onInspect: () => void;
  onDeploy: () => void;
}) {
  const deleteHost = useDeleteHost();
  const st = HOST_STATUS[host.status] ?? HOST_STATUS.pending;
  const info = host.hostInfo;
  const inst = host.latestInstall;
  const deployed = inst?.status === "deployed";
  return (
    <Card className="bg-card/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{host.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {host.user}@{host.host}:{host.port}
            </p>
          </div>
          <Badge variant="outline" className={cn("text-[10px]", st.cls)}>
            {host.status === "validating" && (
              <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            )}
            {st.label}
          </Badge>
        </div>
        {info && (info.gpuName || info.os) && (
          <div className="space-y-1 rounded-md border border-border/60 bg-background/40 p-2 text-xs text-muted-foreground">
            {info.gpuName && (
              <p className="flex items-center gap-1.5">
                <Cpu className="h-3 w-3 text-primary" />
                {info.gpuName}
                {info.gpuVramMb ? ` · ${(info.gpuVramMb / 1024).toFixed(0)} GB` : ""}
              </p>
            )}
            {info.os && (
              <p className="flex items-center gap-1.5">
                <HardDrive className="h-3 w-3 text-primary" />
                {info.os} · {info.arch}
              </p>
            )}
            {info.driverVersion && (
              <p className="flex items-center gap-1.5">
                <Terminal className="h-3 w-3 text-primary" />
                Driver {info.driverVersion} · CUDA {info.driverCuda ?? "?"}
              </p>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            {host.transport === "mock" && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                mock
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {host.authMethod}
            </Badge>
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onInspect}>
              <Terminal className="h-3 w-3" /> Inspect
            </Button>
            <Button
              size="sm"
              variant={deployed ? "default" : "outline"}
              className="h-7 gap-1 text-xs"
              onClick={onDeploy}
            >
              <Rocket className="h-3 w-3" /> Deploy
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs text-destructive hover:text-destructive"
              disabled={deleteHost.isPending}
              onClick={() => {
                if (confirm(`Remove host "${host.name}"? Its checks are deleted too.`))
                  deleteHost.mutate(host.id);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
        {inst && (
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {deployed ? (
              <Rocket className="h-3 w-3 text-success" />
            ) : (
              <Terminal className="h-3 w-3" />
            )}
            {deployed ? "Running" : "Install"}: SN{inst.netuid} · {inst.subnetName} ·{" "}
            {inst.status.replace("_", " ")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function AddHostDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useCreateHost();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"ssh" | "mock">("ssh");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("root");
  const [authMethod, setAuthMethod] = useState<"password" | "key">("password");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const submit = () => {
    setError(null);
    create.mutate(
      { name, transport, host, port: parseInt(port, 10) || 22, user, authMethod, secret },
      {
        onSuccess: () => {
          onOpenChange(false);
          setName("");
          setHost("");
          setSecret("");
          setTransport("ssh");
          setAuthMethod("password");
          setPort("22");
          setUser("root");
        },
        onError: (e) => setError(e.message),
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add GPU host</DialogTitle>
          <DialogDescription>
            The engine connects over SSH and runs the environment pipeline. Credentials
            are encrypted at rest and never displayed again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {transport === "ssh" && (
            <Collapsible
              open={helpOpen}
              onOpenChange={setHelpOpen}
              className="rounded-md border border-border/60 bg-background/40"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 p-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5 text-primary" />
                  Where do I find this?
                  <ChevronDown
                    className={cn(
                      "ml-auto h-3.5 w-3.5 transition-transform",
                      helpOpen && "rotate-180"
                    )}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="space-y-2.5 border-t border-border/60 p-2.5">
                  {PROVIDER_HELP.map((h) => (
                    <div key={h.provider}>
                      <p className="text-xs font-medium">{h.provider}</p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{h.how}</p>
                    </div>
                  ))}
                  <p className="border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Rented GPU pods rarely use port 22 — always copy the mapped port from the
                    provider&apos;s connect string. Private keys must be pasted in full, from
                    -----BEGIN through -----END. The Name is a free-form label only.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="colo-rtx4090" />
            </div>
            <div className="space-y-1">
              <Label>Transport</Label>
              <Select value={transport} onValueChange={(v) => setTransport(v as "ssh" | "mock")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ssh">SSH (real machine)</SelectItem>
                  <SelectItem value="mock">Mock (safe demo)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {transport === "ssh" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label>Host / IP</Label>
                  <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.10" />
                </div>
                <div className="space-y-1">
                  <Label>Port</Label>
                  <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>User</Label>
                  <Input value={user} onChange={(e) => setUser(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Auth</Label>
                  <Select value={authMethod} onValueChange={(v) => setAuthMethod(v as "password" | "key")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">Password</SelectItem>
                      <SelectItem value="key">Private key</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label>{authMethod === "password" ? "Password" : "Private key (PEM)"}</Label>
                <Input
                  type={authMethod === "password" ? "password" : "text"}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={authMethod === "password" ? "••••••••" : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                />
                {authMethod === "key" && (
                  <p className="text-[10px] text-muted-foreground">
                    Paste the entire key file, including the -----BEGIN and -----END lines.
                  </p>
                )}
              </div>
            </>
          )}
          {transport === "mock" && (
            <p className="rounded-md border border-border/60 bg-background/40 p-2 text-xs text-muted-foreground">
              Mock host simulates Ubuntu 22.04 + RTX 4090 with Docker and the NVIDIA
              toolkit missing. Use it to rehearse the full validate → fix → ready loop.
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button className="w-full" disabled={create.isPending} onClick={submit}>
            {create.isPending ? "Adding…" : "Add host"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WizardDialog({
  hostId,
  open,
  onOpenChange,
}: {
  hostId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data, isLoading } = useHostDetail(open ? hostId : null);
  const validate = useValidateHost();
  const fix = useFixStep(hostId);
  const host = data?.host;
  const checks = data?.checks ?? [];
  const busy = validate.isPending || fix.isPending;
  const anyCheck = checks.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            Environment pipeline — {host?.name ?? "host"}
          </DialogTitle>
          <DialogDescription>
            10-step inspection of the GPU machine. Failed steps with a wrench offer a
            one-click fix; anything kernel-level stays manual on purpose.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {host?.status === "validating" || validate.isPending
                ? "Pipeline running…"
                : host?.status === "ready"
                  ? "All steps passed — host is deploy-ready."
                  : "Resolve failed steps (or fix them), then re-run."}
            </p>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={() => validate.mutate(hostId)}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {anyCheck ? "Re-run validation" : "Run validation"}
            </Button>
          </div>

          {isLoading && !anyCheck && (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading checks…
            </p>
          )}

          {!anyCheck && !isLoading && (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No validation run yet — hit “Run validation”.
            </p>
          )}

          {checks.map((c) => {
            const fixable = [5, 6].includes(c.step) && c.status === "fail";
            return (
              <div
                key={c.id}
                className={cn(
                  "rounded-md border p-2.5",
                  c.status === "fail"
                    ? "border-destructive/40 bg-destructive/5"
                    : c.status === "fixed"
                      ? "border-primary/30 bg-primary/5"
                      : c.status === "pass"
                        ? "border-success/30 bg-success/5"
                        : "border-border/60"
                )}
              >
                <div className="flex items-center gap-2">
                  <StepIcon status={c.status} />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {String(c.step).padStart(2, "0")}
                  </span>
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  {c.durationMs > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {(c.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  {fixable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 gap-1 px-2 text-[11px]"
                      disabled={busy}
                      onClick={() => fix.mutate(c.step)}
                    >
                      {fix.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Wrench className="h-3 w-3" />
                      )}
                      Fix
                    </Button>
                  )}
                </div>
                {c.output && (
                  <pre className="mt-1.5 max-h-28 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] leading-snug text-muted-foreground">
                    {c.output}
                  </pre>
                )}
                {c.status === "fail" && c.remediation && (
                  <p className="mt-1 text-[11px] text-warning">{c.remediation}</p>
                )}
              </div>
            );
          })}

          {fix.isError && (
            <p className="text-xs text-destructive">Fix failed: {(fix.error as Error).message}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
