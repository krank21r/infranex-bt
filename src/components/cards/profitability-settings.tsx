"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2, Target, Loader2, CheckCircle2 } from "lucide-react";
import {
  useProfitabilityConfig,
  useSaveProfitabilityConfig,
} from "@/lib/infranex/use-profitability";
import {
  DEFAULT_PROFITABILITY_CONFIG,
  type ProfitabilityConfig,
} from "@/lib/infranex/profitability";

interface ProfitabilitySettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Live pass/fail counts for the preview line. */
  passCount?: number;
  totalCount?: number;
}

const NUM_FIELDS: {
  key: keyof ProfitabilityConfig;
  label: string;
  hint: string;
  min: number;
  step?: number;
}[] = [
  {
    key: "storageMonthlyUsd",
    label: "Storage ($/mo)",
    hint: "NVMe volume for models, logs, datasets",
    min: 0,
    step: 1,
  },
  {
    key: "infraMonthlyUsd",
    label: "Infrastructure ($/mo)",
    hint: "0 = auto by work type (base $40, scraping $120)",
    min: 0,
    step: 1,
  },
  {
    key: "otherOpexMonthlyUsd",
    label: "Other operating ($/mo)",
    hint: "Bandwidth overage, top-up fees, misc",
    min: 0,
    step: 1,
  },
  {
    key: "electricityUsdPerKwh",
    label: "Electricity ($/kWh)",
    hint: "Used when hardware mode is owned",
    min: 0,
    step: 0.01,
  },
  {
    key: "amortizeBurnMonths",
    label: "Burn amortization (months)",
    hint: "Registration burn spread over this many months",
    min: 1,
    step: 1,
  },
];

export function ProfitabilitySettingsDialog({
  open,
  onOpenChange,
  passCount,
  totalCount,
}: ProfitabilitySettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto custom-scroll">
        <DialogHeader>
          <DialogTitle className="text-display flex items-center gap-2 text-xl">
            <Settings2 className="h-4 w-4 text-primary" />
            Profitability settings
          </DialogTitle>
          <DialogDescription>
            The minimum entry rule and every cost line — persisted server-side,
            applied to all {totalCount ?? 129} subnets instantly.
          </DialogDescription>
        </DialogHeader>
        <SettingsForm passCount={passCount} totalCount={totalCount} />
      </DialogContent>
    </Dialog>
  );
}

/** Inner form — remounts on every dialog open, so the draft always starts
 *  from the last saved server config. */
function SettingsForm({
  passCount,
  totalCount,
}: {
  passCount?: number;
  totalCount?: number;
}) {
  const { data: saved } = useProfitabilityConfig();
  const saveMutation = useSaveProfitabilityConfig();
  const [draft, setDraft] = useState<ProfitabilityConfig>(
    saved ?? DEFAULT_PROFITABILITY_CONFIG
  );
  const [dirty, setDirty] = useState(false);

  const set = <K extends keyof ProfitabilityConfig>(
    key: K,
    value: ProfitabilityConfig[K]
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    saveMutation.mutate(draft, {
      onSuccess: () => setDirty(false),
    });
  };

  return (
    <div className="space-y-4">
      {/* --- The minimum entry rule --- */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold">
            Minimum net profit target ($/month)
          </Label>
        </div>
        <Input
          type="number"
          min={0}
          step={25}
          value={String(draft.minNetProfitTargetUsd)}
          onChange={(e) =>
            set("minNetProfitTargetUsd", Math.max(0, Number(e.target.value) || 0))
          }
          className="mt-2 h-10 w-36 text-lg font-bold"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Expected net profit below this →{" "}
          <span className="font-semibold text-destructive">AVOID</span>, regardless
          of score. Default $300/mo.
        </p>
        {passCount != null && totalCount != null && (
          <p className="mt-1.5 text-xs font-medium text-foreground/80">
            {passCount} of {totalCount} subnets pass this target.
          </p>
        )}
      </div>

          {/* --- Cost lines --- */}
          <div className="grid gap-3 sm:grid-cols-2">
            {NUM_FIELDS.map((f) => (
              <div key={String(f.key)}>
                <Label className="text-xs font-medium">{f.label}</Label>
                <Input
                  type="number"
                  min={f.min}
                  step={f.step ?? 1}
                  value={String(draft[f.key] as number)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    set(f.key, (Number.isFinite(n) ? Math.max(f.min, n) : 0) as never);
                  }}
                  className="mt-1 h-8 text-sm"
                />
                <p className="mt-0.5 text-[10px] text-muted-foreground">{f.hint}</p>
              </div>
            ))}
          </div>

          <div>
            <Label className="text-xs font-medium">Hardware mode</Label>
            <Select
              value={draft.hardwareMode}
              onValueChange={(v) => set("hardwareMode", v as "rent" | "owned")}
            >
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rent" className="text-sm">
                  Rent — market GPU rental rates
                </SelectItem>
                <SelectItem value="owned" className="text-sm">
                  Owned — electricity cost model
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Count registration burn as cost</p>
              <p className="text-xs text-muted-foreground">
                Amortized into &quot;Other operating costs&quot;
              </p>
            </div>
            <Switch
              checked={draft.includeRegistrationBurn}
              onCheckedChange={(v) => set("includeRegistrationBurn", v)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Risk-adjusted profit</p>
              <p className="text-xs text-muted-foreground">
                Discount net by seat/alpha/earning risk factor
              </p>
            </div>
            <Switch
              checked={draft.riskAdjustment}
              onCheckedChange={(v) => set("riskAdjustment", v)}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setDirty(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!dirty || saveMutation.isPending}
              className={cn("gap-1.5")}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Save &amp; re-score
            </Button>
          </div>
          {saveMutation.isError && (
            <p className="text-right text-xs text-destructive">
              Save failed — {(saveMutation.error as Error).message}
            </p>
          )}
    </div>
  );
}
