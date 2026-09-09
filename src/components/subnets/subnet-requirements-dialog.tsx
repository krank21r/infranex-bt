"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  Cpu,
  Terminal,
  Server,
  Network,
  Settings,
  Coins,
  Package,
  Zap,
  ExternalLink,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Subnet, MiningRequirements } from "@/lib/infranex/types";

interface SubnetRequirementsDialogProps {
  subnet: Subnet | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartMining?: (s: Subnet) => void;
}

export function SubnetRequirementsDialog({
  subnet,
  open,
  onOpenChange,
  onStartMining,
}: SubnetRequirementsDialogProps) {
  const { toast } = useToast();
  if (!subnet || !subnet.miningRequirements) return null;

  const req = subnet.miningRequirements;

  const copyCommand = () => {
    navigator.clipboard.writeText(req.miner.command);
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
            NetUID {subnet.netuid} · {subnet.category} · Complete technical specifications to mine this subnet
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* GPU Requirements */}
          <Section icon={<Cpu className="h-4 w-4 text-primary" />} title="GPU Requirements">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Spec label="Min VRAM" value={`${req.gpu.minVramGb} GB`} highlight={req.gpu.minVramGb >= 80} />
              <Spec label="Recommended GPU" value={req.gpu.recommendedGpu} />
              <Spec label="GPU Count" value={String(req.gpu.gpuCount)} />
              <Spec label="Min CUDA Compute" value={req.gpu.minCudaComputeCapability} />
              <Spec label="CUDA Version" value={req.runtime.cudaVersion} />
              <Spec label="NVIDIA Runtime" value={req.runtime.nvidiaRuntimeRequired ? "Required" : "Optional"} />
            </div>
            {req.gpu.alternativeGpus.length > 0 && (
              <div className="mt-3">
                <p className="text-[10px] text-muted-foreground mb-1.5">Alternative GPUs (meet VRAM requirement)</p>
                <div className="flex flex-wrap gap-1.5">
                  {req.gpu.alternativeGpus.map((g) => (
                    <Badge key={g} variant="outline" className="text-[10px]">{g}</Badge>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* Hardware Requirements */}
          <Section icon={<Server className="h-4 w-4 text-primary" />} title="Hardware Requirements">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Spec label="Min CPU Cores" value={String(req.hardware.minCpuCores)} />
              <Spec label="Min RAM" value={`${req.hardware.minRamGb} GB`} />
              <Spec label="Recommended RAM" value={`${req.hardware.recommendedRamGb} GB`} />
              <Spec label="Min Disk" value={`${req.hardware.minDiskGb} GB`} />
            </div>
          </Section>

          {/* Runtime & Dependencies */}
          <Section icon={<Package className="h-4 w-4 text-primary" />} title="Runtime & Dependencies">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Spec label="Python" value={req.runtime.pythonVersion} mono />
              <Spec label="CUDA" value={req.runtime.cudaVersion} mono />
              <Spec label="Docker" value={req.runtime.dockerRequired ? "Required" : "Optional"} />
            </div>
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground mb-1.5">Key Python Dependencies</p>
              <div className="flex flex-wrap gap-1.5">
                {req.miner.keyDependencies.map((dep) => (
                  <Badge key={dep} variant="outline" className="mono text-[10px]">{dep}</Badge>
                ))}
              </div>
            </div>
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground mb-1.5">Docker Image</p>
              <pre className="rounded-md border bg-background/80 p-2 font-mono text-xs text-primary">
                {req.runtime.dockerImage}
              </pre>
            </div>
          </Section>

          {/* Network Configuration */}
          <Section icon={<Network className="h-4 w-4 text-primary" />} title="Network Configuration">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Spec label="Network" value={req.network.subtensorNetwork} mono />
              <Spec label="Axon Port" value={String(req.network.axonPort)} mono />
              <Spec label="Prometheus Port" value={String(req.network.prometheusPort)} mono />
            </div>
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground mb-1.5">Subtensor Endpoint</p>
              <pre className="truncate rounded-md border bg-background/80 p-2 font-mono text-xs text-muted-foreground">
                {req.network.subtensorEndpoint}
              </pre>
            </div>
            <div className="mt-2">
              <p className="text-[10px] text-muted-foreground mb-1.5">Open Ports</p>
              <div className="flex flex-wrap gap-1.5">
                {req.network.openPorts.map((p) => (
                  <Badge key={p} variant="outline" className="mono text-[10px]">{p}</Badge>
                ))}
              </div>
            </div>
          </Section>

          {/* Miner Command */}
          <Section icon={<Terminal className="h-4 w-4 text-primary" />} title="Miner Command">
            <div className="relative">
              <pre className="overflow-x-auto rounded-md border bg-background/80 p-3 font-mono text-[11px] text-success custom-scroll">
                {req.miner.command}
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 h-7 w-7"
                onClick={copyCommand}
                aria-label="Copy command"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Spec label="Wallet Name" value={req.miner.walletName} mono />
              <Spec label="Hotkey Name" value={req.miner.hotkeyName} mono />
              <Spec label="Extra Args" value={String(req.miner.extraArgs.length)} />
            </div>
          </Section>

          {/* Docker Configuration */}
          <Section icon={<Settings className="h-4 w-4 text-primary" />} title="Docker Configuration">
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground">Environment Variables</p>
              <div className="space-y-1">
                {req.docker.envVars.map((env) => (
                  <div key={env.name} className="flex items-center justify-between rounded-md border border-border/40 bg-background/60 px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="mono text-xs font-medium">{env.name}</span>
                      {env.required && (
                        <Badge variant="outline" className="border-destructive/30 text-[9px] text-destructive">required</Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">{env.description}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">Volumes</p>
                  {req.docker.volumes.map((v) => (
                    <p key={v.path} className="mono text-xs">{v.path} ({v.sizeGb}GB)</p>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Ports</p>
                  {req.docker.ports.map((p) => (
                    <p key={p} className="mono text-xs">{p}</p>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          {/* Registration Requirements */}
          <Section icon={<Coins className="h-4 w-4 text-primary" />} title="Registration Requirements">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Spec label="Min Stake" value={`${req.registration.minStakeTao} TAO`} mono />
              <Spec label="Reg. Cost" value={`${req.registration.registrationCostTao} TAO`} mono />
              <Spec label="Tempo" value={String(req.registration.tempo)} mono />
              <Spec label="Max Reg/Block" value={String(req.registration.maxRegistrationsPerBlock)} />
            </div>
          </Section>

          {/* Quick Summary Banner */}
          <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-4">
            <p className="text-eyebrow text-primary mb-2">Quick Summary</p>
            <p className="text-sm">
              To mine <strong>{subnet.name}</strong> (α{subnet.netuid}), you need a GPU with
              <span className="font-semibold text-primary"> {req.gpu.minVramGb}GB VRAM</span> ({req.gpu.recommendedGpu}),
              running <span className="mono">Python {req.runtime.pythonVersion}</span> + <span className="mono">CUDA {req.runtime.cudaVersion}</span>,
              with Docker and the NVIDIA runtime. The miner connects to the <span className="mono">{req.network.subtensorNetwork}</span> network
              on port <span className="mono">{req.network.axonPort}</span>. Registration costs ~{req.registration.registrationCostTao} TAO.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {onStartMining && (
              <Button className="gap-2" onClick={() => { onStartMining(subnet); onOpenChange(false); }}>
                <Zap className="h-4 w-4" />
                Start mining
              </Button>
            )}
            {subnet.githubUrl && (
              <Button variant="outline" className="gap-2" onClick={() => window.open(subnet.githubUrl!, "_blank")}>
                <ExternalLink className="h-4 w-4" />
                View GitHub repo
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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
      <p className={cn("mt-0.5 text-sm font-medium", mono && "mono", highlight && "text-primary")}>
        {value}
      </p>
    </div>
  );
}
