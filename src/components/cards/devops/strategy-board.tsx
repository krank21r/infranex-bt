"use client";

import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Cpu,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DevopsMinerDTO } from "@/lib/infranex/use-devops-monitor";

/**
 * DEVOPS-3 — the Miner Mindset strategy board. Per running miner, the
 * posture the engine takes right now (earn more / defend / optimize /
 * steady) plus the strategy facts behind it: per-miner subnet yield, alpha
 * momentum, the best arbitrage alternative, validator-side concentration,
 * our UID's validator trust/consensus, and the recommended serving-stack
 * upgrades. Pure display — actionable versions of these signals arrive as
 * approval-gated ARBITRAGE / RUNTIME_OPT events in the recommendations
 * inbox.
 */

const POSTURE_META: Record<
  DevopsMinerDTO["strategy"]["mindset"],
  { label: string; icon: typeof Activity; chip: string }
> = {
  earn_more: {
    label: "EARN MORE",
    icon: TrendingUp,
    chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  },
  defend: {
    label: "DEFEND",
    icon: ShieldAlert,
    chip: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  },
  optimize: {
    label: "OPTIMIZE",
    icon: Cpu,
    chip: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  },
  steady: {
    label: "STEADY",
    icon: Activity,
    chip: "border-border/60 bg-muted/30 text-muted-foreground",
  },
};

function pctLabel(n: number | null, digits = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${(n * (digits > 0 ? 100 : 1)).toFixed(digits)}${digits > 0 ? "" : "%"}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-eyebrow text-muted-foreground/60">{label}</p>
      <p className={cn("mono mt-0.5 truncate text-sm font-medium tabular", tone ?? "text-foreground/90")}>
        {value}
      </p>
    </div>
  );
}

export function StrategyBoard({ miners }: { miners: DevopsMinerDTO[] }) {
  if (miners.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
        Strategy posture appears once a miner is running — the engine benchmarks its subnet,
        validators and serving stack every 90s pass.
      </p>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {miners.map((m) => {
        const s = m.strategy;
        const posture = POSTURE_META[s.mindset];
        const PostureIcon = posture.icon;
        const alpha = s.alphaChange24h;
        const conc = s.top10IncentiveShare;
        return (
          <div
            key={m.deploymentId}
            className="rounded-xl border border-border/60 bg-background/40 p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                  <span className="truncate">{m.minerName}</span>
                  {m.mode === "mock" && (
                    <Badge variant="outline" className="h-4 shrink-0 px-1 text-[9px] uppercase text-muted-foreground">
                      mock
                    </Badge>
                  )}
                </p>
                <p className="mono text-[10px] text-muted-foreground/60">
                  α{m.netuid} {m.subnetName}
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn("h-5 shrink-0 gap-1 px-1.5 text-[10px]", posture.chip)}
                title={s.headline}
              >
                <PostureIcon className="h-3 w-3" aria-hidden />
                {posture.label}
              </Badge>
            </div>

            <p className="mt-1.5 text-xs text-muted-foreground">{s.headline}</p>

            <div className="mt-3 grid grid-cols-3 gap-2.5">
              <Stat
                label="Yield / miner"
                value={s.perMinerYieldTaoPerDay !== null ? `${s.perMinerYieldTaoPerDay} τ/d` : "—"}
              />
              <Stat
                label="α 24h"
                value={pctLabel(alpha)}
                tone={alpha !== null ? (alpha <= -15 ? "text-red-400" : alpha < 0 ? "text-amber-400" : "text-emerald-400") : undefined}
              />
              <Stat
                label="Top-10 conc."
                value={conc !== null ? `${Math.round(conc * 100)}%` : "—"}
                tone={conc !== null && conc >= 0.8 ? "text-amber-400" : undefined}
              />
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-2.5">
              <Stat
                label="Val. trust"
                value={s.validatorTrust !== null ? s.validatorTrust.toFixed(2) : "—"}
              />
              <Stat label="Consensus" value={s.consensus !== null ? s.consensus.toFixed(2) : "—"} />
              <Stat
                label="Reg. burn"
                value={
                  s.bestAlternative?.burnCostTao != null
                    ? `${s.bestAlternative.burnCostTao >= 1000 ? `${(s.bestAlternative.burnCostTao / 1000).toFixed(1)}k` : Math.round(s.bestAlternative.burnCostTao)} τ`
                    : "—"
                }
              />
            </div>

            {s.bestAlternative && (
              <p className="mt-2.5 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2 py-1.5 text-[11px] leading-snug text-emerald-300">
                <TrendingUp className="mr-1 inline h-3 w-3" aria-hidden />
                Best alternative: α{s.bestAlternative.netuid} {s.bestAlternative.name} —{" "}
                {s.bestAlternative.perMinerYieldTaoPerDay} τ/d per miner ({pctLabel(s.bestAlternative.upliftPct)} vs current)
              </p>
            )}

            {s.recommendedRecipes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.recommendedRecipes.map((r) => (
                  <Badge
                    key={r.id}
                    variant="outline"
                    className="h-5 max-w-full gap-1 px-1.5 text-[10px] border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300"
                    title={r.reason}
                  >
                    <Cpu className="h-3 w-3 shrink-0" aria-hidden />
                    <span className="truncate">{r.label}</span>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
