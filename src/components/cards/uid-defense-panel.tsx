"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert, ShieldCheck, ShieldOff, ShieldHalf, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  blocksToHoursApprox,
  formatBlocksLeft,
  tickRemainingBlocks,
  type UidImmunityInfo,
} from "@/lib/infranex/immunity";
import type { UidDefenseState } from "@/lib/infranex/use-triggers";

/**
 * UID Defense panel — the miner's own metagraph telemetry: incentive
 * sparkline, consensus / cohort badges, and the NOT REGISTERED state.
 */

function Sparkline({ history }: { history: { incentive: number | null }[] }) {
  const points = history.map((h) => h.incentive ?? 0);
  const w = 220;
  const h = 44;
  if (points.length < 2) {
    return (
      <div className="flex h-11 items-center justify-center text-[11px] text-muted-foreground">
        collecting samples…
      </div>
    );
  }
  const max = Math.max(0.01, ...points);
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (p / max) * (h - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-400" />
      <circle
        cx={w}
        cy={h - (points[points.length - 1] / max) * (h - 4) - 2}
        r="2.5"
        className="fill-violet-400"
      />
    </svg>
  );
}

/**
 * Live-ticking immunity chip — remaining = registrationBlock + window −
 * current block, aged client-side (1 block ≈ 12 s) between the 45 s polls.
 *
 *   IMMUNE · 15h 42m left   emerald — protected, plenty of window left
 *   IMMUNE · 42m 10s left   amber   — final 10% of the window
 *   immunity expired        muted   — clock ran out (EVICTABLE risk follows)
 *   immunity window ≈ 16.7h muted   — runtime doesn't expose the reg block
 */
function ImmunityChip({ immunity }: { immunity: UidImmunityInfo }) {
  // Re-render every second so the countdown ticks between polls.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const left = tickRemainingBlocks(immunity);
  const windowH = immunity.windowBlocks !== null ? blocksToHoursApprox(immunity.windowBlocks) : null;
  const title = [
    immunity.registrationBlock !== null
      ? `Registered at block ${immunity.registrationBlock.toLocaleString("en-US")}`
      : "Registration block not exposed by this runtime",
    windowH !== null ? `window ${immunity.windowBlocks?.toLocaleString("en-US")} blocks ≈ ${windowH.toFixed(1)} h` : null,
    immunity.blockNumber !== null ? `sampled at block ${immunity.blockNumber.toLocaleString("en-US")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (left === null) {
    if (immunity.windowBlocks === null) return null;
    return (
      <span
        title={title}
        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        <ShieldHalf className="h-3 w-3" />
        immunity window ≈ {windowH?.toFixed(1)} h
      </span>
    );
  }

  if (left <= 0) {
    return (
      <span
        title={title}
        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground"
      >
        <ShieldOff className="h-3 w-3" />
        immunity expired
      </span>
    );
  }

  const finalStretch = immunity.windowBlocks != null && left < immunity.windowBlocks * 0.1;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
        finalStretch
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-300"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
      )}
    >
      <ShieldCheck className="h-3 w-3" />
      IMMUNE · {formatBlocksLeft(left)} left
    </span>
  );
}

export function UidDefensePanel({ states }: { states: UidDefenseState[] }) {
  if (states.length === 0) return null;

  return (
    <Card className="border-violet-500/20 bg-card/40">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="h-4 w-4 text-violet-400" />
          UID Defense
          <span className="text-xs font-normal text-muted-foreground">
            your UIDs on the metagraph, sampled every pass
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {states.map((s) => (
          <div
            key={s.deploymentId}
            className={cn(
              "rounded-xl border bg-background/30 p-3.5",
              s.riskLevel === "critical"
                ? "border-red-500/40"
                : s.riskLevel === "warning"
                  ? "border-amber-500/40"
                  : "border-border/50"
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{s.minerName}</span>
                <Badge variant="outline" className="mono text-[10px]">
                  α{s.netuid}
                </Badge>
                {s.uid !== null && (
                  <Badge variant="outline" className="mono text-[10px]">
                    UID {s.uid}
                  </Badge>
                )}
                {s.uid !== null && s.immunity && <ImmunityChip immunity={s.immunity} />}
              </div>
              {s.riskCodes.includes("NOT_REGISTERED") ? (
                <Badge variant="outline" className="border-red-500/50 bg-red-500/10 text-red-300">
                  <ShieldAlert className="mr-1 h-3 w-3" />
                  NOT REGISTERED
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className={cn(
                    s.riskLevel === "critical"
                      ? "border-red-500/40 text-red-300"
                      : s.riskLevel === "warning"
                        ? "border-amber-500/40 text-amber-300"
                        : "border-emerald-500/40 text-emerald-300"
                  )}
                >
                  {s.riskLevel}
                  {s.riskCodes.length > 0 && ` · ${s.riskCodes.join(", ")}`}
                </Badge>
              )}
            </div>

            {s.note && <p className="mt-2 text-xs text-muted-foreground">{s.note}</p>}

            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <Sparkline history={s.history} />
              <div className="flex gap-4 text-[11px] text-muted-foreground">
                {s.history.length > 0 && (
                  <span>
                    last incentive{" "}
                    <span className="mono tabular text-foreground/90">
                      {s.history[s.history.length - 1].incentive != null
                        ? `${((s.history[s.history.length - 1].incentive ?? 0) * 100).toFixed(2)}%`
                        : "—"}
                    </span>
                  </span>
                )}
                {s.cohort && (
                  <>
                    <span>
                      median rewarded{" "}
                      <span className="mono tabular text-foreground/90">
                        {(s.cohort.medianRewardedIncentive * 100).toFixed(2)}%
                      </span>
                    </span>
                    <span>
                      earning uids{" "}
                      <span className="mono tabular text-foreground/90">
                        {s.cohort.earningUids}/{s.cohort.registeredUids}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
