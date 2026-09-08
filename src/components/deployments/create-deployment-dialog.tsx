"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CheckCircle2, Rocket, Zap } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { subnets } from "@/lib/infranex/data";
import { useMergedGpuOffers } from "@/lib/infranex/use-gpu-offers";
import { useCreateDeployment } from "@/lib/infranex/use-deployments";
import { useToast } from "@/hooks/use-toast";

interface CreateDeploymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (id: string) => void;
}

export function CreateDeploymentDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateDeploymentDialogProps) {
  const { offers } = useMergedGpuOffers();
  const createMut = useCreateDeployment();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [netuid, setNetuid] = useState<string>("");
  const [offerId, setOfferId] = useState<string>("");
  const [minerName, setMinerName] = useState("");
  const [hotkey, setHotkey] = useState("");
  const [walletName, setWalletName] = useState("infranex");
  const [mode, setMode] = useState<"mock" | "runpod">("mock");

  const subnet = useMemo(() => subnets.find((s) => s.netuid === Number(netuid)), [netuid]);
  const offer = useMemo(() => offers.find((o) => o.id === offerId), [offerId, offers]);

  const vramOk = subnet && offer ? offer.vramGb >= subnet.minVramGb : false;
  const monthlyCost = offer?.monthlyPrice ?? 0;
  const estimatedRevenue = subnet
    ? ({ Training: 3200, Vision: 2800, Multimodal: 3400, Inference: 1800, Data: 1200, Audio: 1400, Compute: 900, Science: 1600, Security: 1500, DeFi: 1100 }[subnet.category] ?? 1500)
    : 0;
  const roi = monthlyCost > 0 ? Math.round(((estimatedRevenue - monthlyCost) / monthlyCost) * 100) : 0;

  const reset = () => {
    setStep(1);
    setNetuid("");
    setOfferId("");
    setMinerName("");
    setHotkey("");
    setWalletName("infranex");
    setMode("mock");
  };

  const handleCreate = async () => {
    if (!subnet || !offer || !minerName.trim()) return;
    try {
      const dep = await createMut.mutateAsync({
        netuid: subnet.netuid,
        offerId: offer.id,
        minerName: minerName.trim(),
        hotkey: hotkey.trim() || undefined,
        walletName: walletName.trim() || undefined,
        mode,
      });
      toast({ title: "Deployment created", description: `${minerName} on ${subnet.name} (α${subnet.netuid})` });
      onCreated?.(dep.id);
      onOpenChange(false);
      reset();
    } catch (e) {
      toast({
        title: "Failed to create deployment",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto custom-scroll">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            <DialogTitle className="text-display text-2xl">Create Deployment</DialogTitle>
          </div>
          <DialogDescription>
            Configure and launch a Bittensor miner on a rented GPU server.
            Step {step} of 3.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                step >= s ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </div>

        {/* Step 1: Select subnet */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Select subnet</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Choose the Bittensor subnet to mine on.
              </p>
              <Select value={netuid} onValueChange={(v) => { setNetuid(v); setOfferId(""); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a subnet…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {subnets.map((s) => (
                    <SelectItem key={s.netuid} value={String(s.netuid)}>
                      <span className="font-medium">{s.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        α{s.netuid} · {s.category} · min {s.minVramGb}GB
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {subnet && (
              <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{subnet.name} <span className="mono text-xs text-muted-foreground">α{subnet.netuid}</span></p>
                    <p className="text-xs text-muted-foreground">{subnet.description}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{subnet.category}</Badge>
                </div>
                <Separator className="my-3" />
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Min VRAM</p>
                    <p className="mono tabular font-medium">{subnet.minVramGb} GB</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Recommended GPU</p>
                    <p className="text-xs font-medium">{subnet.recommendedGpu}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Miners</p>
                    <p className="mono tabular font-medium">{subnet.minersCount}</p>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button disabled={!subnet} onClick={() => setStep(2)}>
                Next: Select GPU
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Select GPU offer */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Select GPU offer</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Live RunPod prices + indicative offers from other providers.
                {subnet && ` Need ≥ ${subnet.minVramGb}GB VRAM.`}
              </p>
              <Select value={offerId} onValueChange={setOfferId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a GPU offer…" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {offers
                    .filter((o) => !subnet || o.vramGb >= subnet.minVramGb)
                    .map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        <span className="font-medium">{o.model}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {o.vramGb}GB · {o.provider} · ${o.hourlyPrice.toFixed(2)}/hr
                        </span>
                        {o.live && (
                          <Badge variant="outline" className="ml-2 border-success/30 text-[9px] text-success">
                            live
                          </Badge>
                        )}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {offer && (
              <div className="rounded-lg border border-border/60 bg-card/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{offer.model}</p>
                    {offer.live ? (
                      <Badge variant="outline" className="border-success/30 text-[9px] text-success">live</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">indicative</Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{offer.provider} · {offer.region}</span>
                </div>
                <Separator className="my-3" />
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Hourly</p>
                    <p className="tabular font-medium text-primary">${offer.hourlyPrice.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">Monthly</p>
                    <p className="tabular font-medium">${offer.monthlyPrice}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground">VRAM</p>
                    <p className="mono tabular font-medium">{offer.vramGb} GB</p>
                  </div>
                </div>
                {vramOk ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Meets subnet VRAM requirement ({subnet?.minVramGb}GB)
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Insufficient VRAM (need {subnet?.minVramGb}GB)
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button disabled={!offer || !vramOk} onClick={() => setStep(3)}>
                Next: Configure
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Configure + deploy */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="miner-name" className="text-sm font-medium">Miner name</Label>
                <Input
                  id="miner-name"
                  placeholder="apex-prod-01"
                  value={minerName}
                  onChange={(e) => setMinerName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="wallet" className="text-sm font-medium">Wallet name</Label>
                <Input
                  id="wallet"
                  placeholder="infranex"
                  value={walletName}
                  onChange={(e) => setWalletName(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="hotkey" className="text-sm font-medium">Hotkey (SS58 address, optional)</Label>
              <Input
                id="hotkey"
                placeholder="5FKtj8nP3qW7vR2sN6mB1cD4eF8gH9iJ0kL"
                value={hotkey}
                onChange={(e) => setHotkey(e.target.value)}
                className="mt-1 mono text-xs"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                The Bittensor hotkey registered on the subnet. Leave empty to generate later.
              </p>
            </div>

            <div>
              <Label className="text-sm font-medium">Deployment mode</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMode("mock")}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    mode === "mock" ? "border-primary/40 bg-primary/[0.06]" : "border-border/60 bg-card/30"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">Mock</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Simulates the full lifecycle. No real GPU, no cost.
                  </p>
                </button>
                <button
                  onClick={() => setMode("runpod")}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    mode === "runpod" ? "border-primary/40 bg-primary/[0.06]" : "border-border/60 bg-card/30"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Rocket className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">RunPod (real)</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Creates a real GPU pod. Costs real money.
                  </p>
                </button>
              </div>
            </div>

            {mode === "runpod" && (
              <div className="rounded-lg border border-warning/30 bg-warning/[0.04] p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="text-xs">
                    <p className="font-medium text-warning">Real deployment — costs money</p>
                    <p className="mt-1 text-muted-foreground">
                      This will create a real RunPod GPU pod at ${offer?.hourlyPrice.toFixed(2)}/hr
                      (~${monthlyCost}/mo). You'll be billed by RunPod until you terminate it.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Cost projection */}
            <div className="rounded-lg border border-border/60 bg-card/40 p-4">
              <p className="text-eyebrow text-muted-foreground mb-3">Cost projection</p>
              <div className="grid grid-cols-4 gap-3 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground">Cost/mo</p>
                  <p className="tabular text-lg font-bold text-destructive">{formatCurrency(monthlyCost)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Rev/mo (est)</p>
                  <p className="tabular text-lg font-bold text-success">{formatCurrency(estimatedRevenue)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Profit/mo</p>
                  <p className="tabular text-lg font-bold">{formatCurrency(estimatedRevenue - monthlyCost)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">ROI</p>
                  <p className={cn("tabular text-lg font-bold", roi >= 0 ? "text-success" : "text-destructive")}>
                    {roi >= 0 ? "+" : ""}{roi}%
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button
                disabled={!minerName.trim() || createMut.isPending}
                onClick={handleCreate}
                className="gap-2"
              >
                <Rocket className="h-4 w-4" />
                {createMut.isPending ? "Creating…" : mode === "runpod" ? "Deploy (real)" : "Create deployment"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
