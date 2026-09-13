"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Thermometer,
  Gauge,
  MemoryStick,
  Bot,
  CircleAlert,
  CircleX,
  Radar,
  Wallet,
  Hexagon,
  Activity,
  RadioTower,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { DevopsMinerDTO, DevopsThresholds } from "@/lib/infranex/use-devops-monitor";

/**
 * DEVOPS-1 — one live operations card per running miner: GPU vitals +
 * sparkline history, daemon heartbeat, chain facts, registration state and
 * risk coloring. Pure presentational; data comes from /api/devops/monitor.
 */

type Health = "healthy" | "warning" | "critical";

export function MinerOpsCard({
  miner,
  thresholds,
}: {
  miner: DevopsMinerDTO;
  thresholds: DevopsThresholds;
}) {
  const health = computeHealth(miner, thresholds);
  const isMock = miner.mode === "mock";

  return (
    <Card
      className={cn(
        "overflow-hidden border-border/60 bg-card/60 transition-colors",
        health === "critical" && "border-destructive/40",
        health === "warning" && "border-amber-500/30"
      )}
    >
      <div
        className={cn(
          "h-0.5 w-full",
          health === "healthy" && "bg-success/70",
          health === "warning" && "bg-amber-400/80",
          health === "critical" && "bg-destructive"
        )}
        aria-hidden
      />
      <CardContent className="space-y-3 p-4">
        {/* Header: miner + subnet + state */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <HealthDot health={health} />
              <p className="truncate text-display text-sm font-semibold">{miner.minerName}</p>
              {isMock && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                  mock
                </Badge>
              )}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Hexagon className="h-3 w-3 shrink-0 text-primary/70" aria-hidden />
              <span className="mono tabular">α{miner.netuid}</span>
              <span className="truncate">{miner.subnetName}</span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="mono text-[10px] uppercase tracking-wider text-muted-foreground/70">{miner.gpuModel}</p>
            <p className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <Wallet className="h-3 w-3" aria-hidden />
              <span className="mono tabular">${miner.monthlyCost.toFixed(0)}/mo</span>
            </p>
          </div>
        </div>

        {/* GPU vitals */}
        <div className="grid grid-cols-2 gap-2">
          <Vital
            icon={<Thermometer className="h-3.5 w-3.5" aria-hidden />}
            label="Temp"
            value={miner.gpu?.tempC != null ? `${miner.gpu.tempC.toFixed(0)}°C` : "—"}
            tone={
              miner.gpu?.tempC == null
                ? "muted"
                : miner.gpu.tempC >= thresholds.tempCriticalC
                  ? "critical"
                  : miner.gpu.tempC >= thresholds.tempWarnC
                    ? "warning"
                    : "ok"
            }
          />
          <Vital
            icon={<Gauge className="h-3.5 w-3.5" aria-hidden />}
            label="Util"
            value={miner.gpu?.utilPct != null ? `${miner.gpu.utilPct.toFixed(0)}%` : "—"}
            tone={
              miner.gpu?.utilPct == null
                ? "muted"
                : miner.gpu.utilPct < thresholds.utilFloorPct
                  ? "warning"
                  : "ok"
            }
          />
          <Vital
            icon={<MemoryStick className="h-3.5 w-3.5" aria-hidden />}
            label="VRAM"
            value={
              miner.gpu?.memUsedMb != null && miner.gpu?.memTotalMb
                ? `${(miner.gpu.memUsedMb / 1024).toFixed(1)}/${(miner.gpu.memTotalMb / 1024).toFixed(0)}G`
                : "—"
            }
            tone="muted"
          />
          <Vital
            icon={<Bot className="h-3.5 w-3.5" aria-hidden />}
            label="Miner"
            value={
              miner.gpu?.processAlive === true
                ? "running"
                : miner.gpu?.processAlive === false
                  ? "DOWN"
                  : isMock
                    ? "simulated"
                    : "unknown"
            }
            tone={
              miner.gpu?.processAlive === false ? "critical" : miner.gpu?.processAlive === true ? "ok" : "muted"
            }
          />
        </div>

        {/* Sparklines (history from the 90s pass) */}
        {miner.gpuHistory.length > 1 && (
          <div className="grid grid-cols-2 gap-2">
            <Sparkline
              label={`temp · ${miner.gpuHistory.length} samples`}
              points={miner.gpuHistory.map((h) => h.tempC)}
              warnLine={thresholds.tempWarnC}
              critLine={thresholds.tempCriticalC}
              stroke="stroke-sky-400/80"
            />
            <Sparkline
              label="util"
              points={miner.gpuHistory.map((h) => h.utilPct)}
              warnLine={thresholds.utilFloorPct}
              stroke="stroke-emerald-400/80"
            />
          </div>
        )}

        {/* Daemon heartbeat */}
        <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Radar className="h-3 w-3" aria-hidden />
            daemon
          </span>
          <span className="flex items-center gap-2 text-[11px]">
            <DaemonChip status={isMock ? "mock" : miner.daemon?.status ?? "missing"} />
            {miner.daemon?.lastSeenAt && (
              <span className="mono tabular text-muted-foreground/70">
                {formatRelativeTime(miner.daemon.lastSeenAt)}
              </span>
            )}
          </span>
        </div>

        {/* DEVOPS-4 — Service & validator traffic: what validators experience */}
        <div className="rounded-lg border border-border/50 bg-background/40 px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70">
              <Activity className="h-3 w-3" aria-hidden />
              service
            </span>
            <ProbeChip probe={miner.service?.probe ?? null} isMock={isMock} />
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-center">
            <MiniFact
              label="Latency"
              value={
                miner.service?.probe?.ok
                  ? `${Math.round(miner.service.probe.totalMs ?? 0)}ms`
                  : miner.service?.probe && !miner.service.probe.ok
                    ? "FAIL"
                    : "—"
              }
              tone={miner.service?.probe && !miner.service.probe.ok ? "critical" : undefined}
            />
            <MiniFact
              label="p50 / p95"
              value={
                miner.service?.latencyP50Ms != null
                  ? `${Math.round(miner.service.latencyP50Ms)}/${miner.service.latencyP95Ms != null ? Math.round(miner.service.latencyP95Ms) : "—"}`
                  : "—"
              }
            />
            <MiniFact
              label="Probe OK"
              value={
                miner.service?.successRatePct != null
                  ? `${miner.service.successRatePct}%`
                  : "—"
              }
              tone={
                miner.service?.successRatePct != null && miner.service.successRatePct < 100
                  ? "warning"
                  : undefined
              }
            />
          </div>
          {miner.service?.probe && miner.service.probeHistory.length > 1 && (
            <div className="mt-1.5">
              <Sparkline
                label="axon latency · ms"
                points={miner.service.probeHistory.map((p) => p.totalMs)}
                stroke="stroke-violet-400/80"
              />
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border/40 pt-1.5 text-[11px]">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <RadioTower className="h-3 w-3" aria-hidden />
              validator queries
            </span>
            <TrafficSummary traffic={miner.service?.traffic ?? null} isMock={isMock} />
          </div>
        </div>

        {/* Chain + UID facts */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <MiniFact label="UID" value={miner.uid?.uid != null ? `#${miner.uid.uid}` : "—"} />
          <MiniFact
            label="Incentive"
            value={miner.uid?.incentive != null ? `${(miner.uid.incentive * 100).toFixed(2)}%` : "—"}
          />
          <MiniFact
            label="Net / mo"
            value={
              miner.chain.netProfitPerMonthUsd != null
                ? `$${miner.chain.netProfitPerMonthUsd.toFixed(0)}`
                : "—"
            }
            tone={
              miner.chain.netProfitPerMonthUsd != null && miner.chain.netProfitPerMonthUsd < 0
                ? "critical"
                : undefined
            }
          />
        </div>

        {/* Registration + risk + ROI */}
        <div className="flex flex-wrap items-center gap-1.5">
          {miner.registration.state && (
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[10px]",
                miner.registration.state === "registered"
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-border text-muted-foreground"
              )}
            >
              {miner.registration.state}
              {miner.registration.registeredUid != null ? ` · uid ${miner.registration.registeredUid}` : ""}
            </Badge>
          )}
          {miner.uid && miner.uid.riskLevel !== "healthy" && (
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[10px]",
                miner.uid.riskLevel === "critical"
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-300"
              )}
            >
              {miner.uid.riskLevel}: {miner.uid.riskCodes.join(", ").toLowerCase()}
            </Badge>
          )}
          {miner.chain.roiPercent != null && (
            <Badge
              variant="outline"
              className={cn(
                "h-5 px-1.5 text-[10px]",
                miner.chain.roiPercent < 0
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border text-muted-foreground"
              )}
            >
              ROI {miner.chain.roiPercent > 0 ? "+" : ""}
              {miner.chain.roiPercent}%
            </Badge>
          )}
        </div>

        {/* Alerts */}
        {miner.alerts.length > 0 && (
          <ul className="space-y-1">
            {miner.alerts.map((a) => (
              <li
                key={a.code}
                className={cn(
                  "flex items-start gap-1.5 rounded-md px-2 py-1 text-[11px]",
                  a.level === "critical"
                    ? "bg-destructive/10 text-destructive"
                    : a.level === "warning"
                      ? "bg-amber-500/10 text-amber-300"
                      : "bg-muted/40 text-muted-foreground"
                )}
              >
                {a.level === "critical" ? (
                  <CircleX className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                )}
                {a.message}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function computeHealth(miner: DevopsMinerDTO, t: DevopsThresholds): Health {
  const temp = miner.gpu?.tempC ?? null;
  if (
    miner.alerts.some((a) => a.level === "critical") ||
    miner.uid?.riskLevel === "critical" ||
    miner.gpu?.processAlive === false ||
    (temp !== null && temp >= t.tempCriticalC)
  ) {
    return "critical";
  }
  if (
    miner.alerts.some((a) => a.level === "warning") ||
    miner.uid?.riskLevel === "warning" ||
    (temp !== null && temp >= t.tempWarnC) ||
    (miner.gpu?.utilPct != null && miner.gpu.utilPct < t.utilFloorPct)
  ) {
    return "warning";
  }
  return "healthy";
}

function HealthDot({ health }: { health: Health }) {
  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        health === "healthy" && "bg-success pulse-dot",
        health === "warning" && "bg-amber-400",
        health === "critical" && "bg-destructive"
      )}
      aria-hidden
    />
  );
}

function Vital({
  icon,
  label,
  value,
  tone = "muted",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "ok" | "warning" | "critical" | "muted";
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          "mono mt-0.5 text-sm font-semibold tabular",
          tone === "ok" && "text-success",
          tone === "warning" && "text-amber-300",
          tone === "critical" && "text-destructive",
          tone === "muted" && "text-foreground/80"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MiniFact({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warning" | "critical";
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-background/40 px-1.5 py-1">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <p
        className={cn(
          "mono text-xs font-semibold tabular",
          tone === "ok" && "text-success",
          tone === "warning" && "text-amber-300",
          tone === "critical" && "text-destructive",
          !tone && "text-foreground/85"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function DaemonChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    online: "border-success/40 bg-success/10 text-success",
    unreachable: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    missing: "border-border text-muted-foreground",
    mock: "border-border text-muted-foreground",
    pending: "border-border text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={cn("h-4 px-1.5 text-[10px]", map[status] ?? map.missing)}>
      {status}
    </Badge>
  );
}

/** DEVOPS-4 — probe verdict chip: alive + latency, dead, or simulated. */
function ProbeChip({
  probe,
  isMock,
}: {
  probe: { ok: boolean; totalMs: number | null; httpStatus: number | null; mode: string } | null;
  isMock: boolean;
}) {
  if (!probe) {
    return (
      <Badge variant="outline" className="h-4 px-1.5 text-[10px] border-border text-muted-foreground">
        no probe
      </Badge>
    );
  }
  if (!probe.ok) {
    return (
      <Badge variant="outline" className="h-4 px-1.5 text-[10px] border-destructive/40 bg-destructive/10 text-destructive">
        dead
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="h-4 px-1.5 text-[10px] border-success/40 bg-success/10 text-success">
      {isMock ? "simulated" : `HTTP ${probe.httpStatus ?? "?"}`}
    </Badge>
  );
}

/** DEVOPS-4 — validator traffic summary: queries/hour + distinct validators. */
function TrafficSummary({
  traffic,
  isMock,
}: {
  traffic: {
    requests: number | null;
    distinctValidators: number | null;
    topValidatorHotkey: string | null;
  } | null;
  isMock: boolean;
}) {
  if (!traffic) {
    return <span className="mono tabular text-muted-foreground/60">no data</span>;
  }
  if (traffic.requests === null) {
    return <span className="mono tabular text-muted-foreground/60">unknown — no parsable query log</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className="mono tabular text-foreground/90">{traffic.requests}/hr</span>
      {traffic.distinctValidators != null && (
        <span className="mono tabular text-muted-foreground/70">
          · {traffic.distinctValidators} validator{traffic.distinctValidators === 1 ? "" : "s"}
        </span>
      )}
      {isMock && <span className="text-[10px] text-muted-foreground/50">simulated</span>}
    </span>
  );
}

/** Hand-rolled sparkline — no chart lib; thresholds render as dashed lines. */
function Sparkline({
  label,
  points,
  warnLine,
  critLine,
  stroke,
}: {
  label: string;
  points: (number | null)[];
  warnLine?: number;
  critLine?: number;
  stroke: string;
}) {
  const clean = points.map((p) => p ?? 0);
  const W = 100;
  const H = 28;
  const max = Math.max(...clean, critLine ?? 0, warnLine ?? 0, 1);
  const min = Math.min(...clean, 0);
  const span = Math.max(max - min, 1);
  const toXY = (v: number, i: number) => {
    const x = clean.length > 1 ? (i / (clean.length - 1)) * W : W / 2;
    const y = H - ((v - min) / span) * (H - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  const line = clean.map((v, i) => toXY(v, i)).join(" ");
  const hasData = clean.some((v) => v > 0);

  return (
    <div className="rounded-lg border border-border/50 bg-background/40 px-2 pt-1 pb-0.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">{label}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden>
        {hasData && warnLine != null && warnLine >= min && warnLine <= max && (
          <line
            x1="0"
            x2={W}
            y1={H - ((warnLine - min) / span) * (H - 4) - 2}
            y2={H - ((warnLine - min) / span) * (H - 4) - 2}
            className="stroke-amber-400/40"
            strokeDasharray="3 3"
            strokeWidth="0.6"
          />
        )}
        {hasData && critLine != null && critLine >= min && critLine <= max && (
          <line
            x1="0"
            x2={W}
            y1={H - ((critLine - min) / span) * (H - 4) - 2}
            y2={H - ((critLine - min) / span) * (H - 4) - 2}
            className="stroke-destructive/50"
            strokeDasharray="2 3"
            strokeWidth="0.6"
          />
        )}
        {hasData ? (
          <polyline
            points={line}
            fill="none"
            className={stroke}
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          <line x1="0" x2={W} y1={H - 2} y2={H - 2} className="stroke-muted-foreground/30" strokeWidth="1" />
        )}
      </svg>
    </div>
  );
}
