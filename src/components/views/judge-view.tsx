"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Gavel,
  RefreshCw,
  Play,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Fish,
  Scale,
  Heart,
  Info,
  Sparkles,
} from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useNetwork } from "@/lib/infranex/use-network";
import { subnets as curatedSubnets } from "@/lib/infranex/data";
import {
  useJudgeProfiles,
  useJudgeRuns,
  useJudgeSimulate,
  useJudgeSync,
  type JudgeProfileData,
  type JudgeKind,
} from "@/lib/infranex/judge/use-judge";

const KIND_BADGE: Record<JudgeKind, { label: string; className: string }> = {
  latency_race: { label: "Latency Race", className: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30" },
  quality_judge: { label: "Quality Judge", className: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  market_clearing: { label: "Market Clearing", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  uptime_sla: { label: "Uptime SLA", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  resource_fit: { label: "Resource Fit", className: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  unknown: { label: "Unclassified", className: "bg-muted text-muted-foreground border-border" },
};

const VERDICT_BADGE: Record<string, string> = {
  strong: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  competitive: "bg-lime-500/15 text-lime-300 border-lime-500/30",
  marginal: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  weak: "bg-red-500/15 text-red-300 border-red-500/30",
};

const BAND_META: Record<string, { label: string; icon: typeof Fish; className: string }> = {
  forgiving: { label: "Forgiving", icon: Heart, className: "text-emerald-300" },
  moderate: { label: "Moderate", icon: Scale, className: "text-lime-300" },
  brutal: { label: "Brutal", icon: ShieldAlert, className: "text-amber-300" },
  shark_tank: { label: "Shark Tank", icon: Fish, className: "text-red-300" },
};

const DEFAULT_SPEC = {
  latencyMs: 2000,
  uptimePct: 99.5,
  qualityPct: 80,
  throughputTps: 25,
  pricePerMTokUsd: 0.5,
};

export function JudgeView() {
  const { data: net } = useNetwork();
  const { data: profilesData } = useJudgeProfiles();
  const { data: runsData } = useJudgeRuns();
  const syncProfile = useJudgeSync();
  const simulate = useJudgeSimulate();

  const [netuid, setNetuid] = useState<number | null>(null);
  const [profile, setProfile] = useState<JudgeProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [spec, setSpec] = useState(DEFAULT_SPEC);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<(Record<string, unknown> & { composite: number; verdict: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profiledNetuids = useMemo(
    () => new Set((profilesData?.profiles ?? []).map((p) => p.netuid)),
    [profilesData]
  );

  // Live subnets merged with the curated list for the picker.
  const subnets = useMemo(() => {
    const names = new Map<number, string>();
    for (const s of curatedSubnets) names.set(s.netuid, s.name);
    for (const s of net?.subnets ?? []) {
      if (s.name) names.set(s.netuid, s.name);
    }
    return [...names.entries()]
      .map(([netuid, name]) => ({ netuid, name }))
      .sort((a, b) => a.netuid - b.netuid);
  }, [net]);

  // Load profile when a subnet is picked.
  useEffect(() => {
    if (netuid === null) return;
    let cancelled = false;
    setProfileLoading(true);
    setError(null);
    fetch(`/api/judge/profiles?netuid=${netuid}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setProfile(j.profile ?? null);
      })
      .catch(() => !cancelled && setError("Failed to load profile"))
      .finally(() => !cancelled && setProfileLoading(false));
    return () => {
      cancelled = true;
    };
  }, [netuid]);

  const handleSync = async () => {
    if (netuid === null) return;
    setSyncing(true);
    setError(null);
    try {
      const j = await syncProfile(netuid);
      setProfile(j.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleRun = async () => {
    if (netuid === null) return;
    setRunning(true);
    setError(null);
    try {
      const j = await simulate(netuid, spec);
      setResult(j.result);
      setProfile(j.profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    } finally {
      setRunning(false);
    }
  };

  // Latency slider: log scale 100ms → 600_000ms.
  const latencyValue = Math.log10(spec.latencyMs);
  const setLatencyLog = (v: number) =>
    setSpec((s) => ({ ...s, latencyMs: Math.round(Math.pow(10, v)) }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-eyebrow text-primary">Judge Intelligence</p>
          <h2 className="text-display text-2xl font-bold tracking-tight">Judge Lab</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Deconstruct each subnet&apos;s validator scoring BEFORE spending on hardware, then
            simulate your miner against it. Evidence-cited, cohort-aware, honestly uncertain.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={netuid === null ? "" : String(netuid)}
            onValueChange={(v) => {
              setNetuid(Number(v));
              setResult(null);
            }}
          >
            <SelectTrigger className="w-[260px] bg-card/60">
              <SelectValue placeholder="Pick a subnet…" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {subnets.map((s) => (
                <SelectItem key={s.netuid} value={String(s.netuid)}>
                  <span className="mono">α{s.netuid}</span> · {s.name}
                  {profiledNetuids.has(s.netuid) && (
                    <span className="ml-1 text-primary">· profiled</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={netuid === null || syncing}
            className="gap-1.5"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
            {syncing ? "Mining…" : "Re-mine profile"}
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="py-3 text-sm text-red-300">{error}</CardContent>
        </Card>
      )}

      {netuid === null ? (
        <Card className="border-border/60 bg-card/40">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Gavel className="h-10 w-10 text-primary/40" />
            <p className="text-sm">
              Pick a subnet above — the lab mines its validator&apos;s scoring behaviour from the
              subnet&apos;s own repo + on-chain cohort telemetry.
            </p>
          </CardContent>
        </Card>
      ) : profileLoading ? (
        <Card className="border-border/60 bg-card/40">
          <CardContent className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span className="text-sm">Mining judge profile…</span>
          </CardContent>
        </Card>
      ) : !profile ? (
        <Card className="border-border/60 bg-card/40">
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            No profile yet — hit <span className="text-foreground">Re-mine profile</span>.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Profile panel */}
          <Card className="border-border/60 bg-card/40">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gavel className="h-4 w-4 text-primary" />
                  Judge profile · α{profile.netuid} {profile.subnetName}
                </CardTitle>
                <Badge variant="outline" className={KIND_BADGE[profile.judgeKind]?.className}>
                  {KIND_BADGE[profile.judgeKind]?.label ?? profile.judgeKind}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{profile.summary}</p>

              {/* Confidence */}
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-eyebrow text-muted-foreground">Profile confidence</span>
                  <span className="mono tabular text-foreground/80">
                    {Math.round(profile.confidence * 100)}%
                  </span>
                </div>
                <Progress value={profile.confidence * 100} className="h-1.5" />
              </div>

              <Separator className="bg-border/40" />

              {/* Cohort brutality */}
              <CohortCard cohort={profile.cohort} />

              <Separator className="bg-border/40" />

              {/* Weight bars with evidence */}
              <div className="space-y-2.5">
                <p className="text-eyebrow text-muted-foreground">Composite weights</p>
                {profile.dimensions
                  .slice()
                  .sort((a, b) => b.weight - a.weight)
                  .map((d) => (
                    <WeightBar key={d.key} dim={d} />
                  ))}
              </div>

              {/* Sources */}
              {profile.sources?.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <p className="text-eyebrow mb-1">Sources</p>
                  <ul className="space-y-0.5">
                    {profile.sources.slice(0, 5).map((s, i) => (
                      <li key={i} className="truncate">
                        · {s.kind}
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 text-primary/80 hover:text-primary"
                          >
                            {s.url.replace("https://github.com/", "")}
                          </a>
                        ) : s.note ? (
                          <span className="ml-1">{s.note}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Simulator + verdict */}
          <div className="space-y-6">
            <Card className="border-border/60 bg-card/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Mock-validator simulator
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <SimSlider
                  label="Response latency"
                  display={
                    spec.latencyMs >= 1000
                      ? `${(spec.latencyMs / 1000).toFixed(spec.latencyMs < 10_000 ? 2 : 1)}s`
                      : `${spec.latencyMs}ms`
                  }
                  min={2} // log10(100)
                  max={5.778} // log10(600_000)
                  step={0.01}
                  value={latencyValue}
                  onChange={setLatencyLog}
                />
                <SimSlider
                  label="Uptime"
                  display={`${spec.uptimePct.toFixed(2)}%`}
                  min={90}
                  max={100}
                  step={0.1}
                  value={spec.uptimePct}
                  onChange={(v) => setSpec((s) => ({ ...s, uptimePct: Math.round(v * 10) / 10 }))}
                />
                <SimSlider
                  label="Response quality"
                  display={`${Math.round(spec.qualityPct)}%`}
                  min={0}
                  max={100}
                  step={1}
                  value={spec.qualityPct}
                  onChange={(v) => setSpec((s) => ({ ...s, qualityPct: Math.round(v) }))}
                />
                <SimSlider
                  label="Throughput"
                  display={`${Math.round(spec.throughputTps)} units/s`}
                  min={0}
                  max={200}
                  step={1}
                  value={spec.throughputTps}
                  onChange={(v) => setSpec((s) => ({ ...s, throughputTps: Math.round(v) }))}
                />
                <SimSlider
                  label="Price / 1M tokens"
                  display={`$${spec.pricePerMTokUsd.toFixed(2)}`}
                  min={0}
                  max={5}
                  step={0.05}
                  value={spec.pricePerMTokUsd}
                  onChange={(v) =>
                    setSpec((s) => ({ ...s, pricePerMTokUsd: Math.round(v * 100) / 100 }))
                  }
                />
                <Button onClick={handleRun} disabled={running} className="w-full gap-2">
                  <Play className="h-4 w-4" />
                  {running ? "Scoring against judge…" : "Run simulation"}
                </Button>
              </CardContent>
            </Card>

            {result && <VerdictPanel result={result} />}
          </div>
        </div>
      )}

      {/* Recent runs */}
      {(runsData?.runs?.length ?? 0) > 0 && (
        <Card className="border-border/60 bg-card/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {runsData!.runs.slice(0, 8).map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-background/30 px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="mono text-xs text-muted-foreground">α{r.netuid}</span>
                    <span className="font-medium">{r.subnetName}</span>
                    <Badge variant="outline" className={cn("text-[10px]", VERDICT_BADGE[r.verdict])}>
                      {r.verdict}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="mono tabular">
                      composite <span className="text-foreground">{r.composite.toFixed(1)}</span>
                    </span>
                    <span className="mono tabular">~p{r.result?.percentileEstimate ?? "—"}</span>
                    <span>{formatRelativeTime(r.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function CohortCard({ cohort }: { cohort: JudgeProfileData["cohort"] }) {
  const meta = BAND_META[cohort.band] ?? BAND_META.moderate;
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border border-border/50 bg-background/30 p-4">
      <div className="flex items-center justify-between">
        <p className="text-eyebrow text-muted-foreground">Cohort brutality</p>
        <span className={cn("flex items-center gap-1.5 text-sm font-semibold", meta.className)}>
          <Icon className="h-4 w-4" />
          {meta.label}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-display text-3xl font-bold">{cohort.brutality}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
      <Progress value={cohort.brutality} className="mt-2 h-1.5" />
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-4">
        <div>
          <span className="block text-foreground/90 mono tabular">{cohort.registeredUids}</span>
          registered
        </div>
        <div>
          <span className="block text-foreground/90 mono tabular">{cohort.earningUids}</span>
          earning
        </div>
        <div>
          <span className="block text-foreground/90 mono tabular">
            {(cohort.earningRatio * 100).toFixed(1)}%
          </span>
          earn ratio
        </div>
        <div>
          <span className="block text-foreground/90 mono tabular">
            {(cohort.top10Take * 100).toFixed(0)}%
          </span>
          top-10% take
        </div>
      </div>
    </div>
  );
}

function WeightBar({ dim }: { dim: JudgeProfileData["dimensions"][number] }) {
  const [open, setOpen] = useState(false);
  const pct = Math.round(dim.weight * 100);
  return (
    <div>
      <button
        className="flex w-full items-center gap-2 text-left"
        onClick={() => dim.evidence.length > 0 && setOpen(!open)}
      >
        {dim.evidence.length > 0 ? (
          open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="w-44 shrink-0 text-sm">{dim.label}</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
          <div
            className="h-full rounded-full bg-primary/70"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="mono w-10 shrink-0 text-right text-xs tabular text-muted-foreground">
          {pct}%
        </span>
      </button>
      {open && dim.evidence.length > 0 && (
        <div className="mt-1.5 ml-6 space-y-1 rounded-lg border border-border/40 bg-background/40 p-2.5">
          {dim.evidence.map((ev, i) => (
            <div key={i} className="text-xs">
              <span className="mono text-[10px] text-primary/70">{ev.file}</span>
              <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
                {ev.line}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SimSlider(props: {
  label: string;
  display: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-eyebrow text-muted-foreground">{props.label}</span>
        <span className="mono tabular text-foreground/90">{props.display}</span>
      </div>
      <Slider
        min={props.min}
        max={props.max}
        step={props.step}
        value={[props.value]}
        onValueChange={([v]) => props.onChange(v)}
        className="[&_[data-slot=slider-range]]:bg-primary"
      />
    </div>
  );
}

 
function VerdictPanel({ result }: { result: any }) {
  const dims = (result.dimensionScores ?? []) as {
    key: string;
    label: string;
    weight: number;
    score: number;
    contribution: number;
    note: string;
  }[];
  const recs = (result.recommendations ?? []) as { label: string; gain: number; text: string }[];
  return (
    <Card className="border-primary/30 bg-card/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Verdict</CardTitle>
          <Badge variant="outline" className={VERDICT_BADGE[result.verdict] ?? ""}>
            {result.verdict}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-border/50 bg-background/30 p-3">
            <p className="text-display text-3xl font-bold">{result.composite.toFixed(1)}</p>
            <p className="text-eyebrow mt-1 text-muted-foreground">composite</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/30 p-3">
            <p className="text-display text-3xl font-bold">~p{result.percentileEstimate}</p>
            <p className="text-eyebrow mt-1 text-muted-foreground">cohort percentile</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-background/30 p-3">
            <p className="text-display text-3xl font-bold">
              {result.medianMultiple.toFixed(2)}×
            </p>
            <p className="text-eyebrow mt-1 text-muted-foreground">vs median</p>
          </div>
        </div>

        <div className="space-y-2">
          {dims.map((d) => (
            <div key={d.key} className="flex items-center gap-2">
              <span className="w-44 shrink-0 truncate text-xs text-muted-foreground" title={d.note}>
                {d.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                <div className="flex h-full">
                  <div
                    className="h-full bg-primary/80"
                    style={{ width: `${Math.min(100, d.contribution * 100)}%` }}
                  />
                  <div
                    className="h-full bg-muted/20"
                    style={{ width: `${Math.max(0, (d.weight - d.contribution) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="mono w-12 shrink-0 text-right text-[11px] tabular text-muted-foreground">
                {d.score.toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        {recs.length > 0 && (
          <div>
            <p className="text-eyebrow mb-1.5 text-muted-foreground">Highest-leverage fixes</p>
            <div className="space-y-1.5">
              {recs.map((r, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-border/40 bg-background/30 p-2.5 text-xs"
                >
                  <Badge variant="outline" className="mt-0.5 shrink-0 border-primary/30 text-primary">
                    +{r.gain.toFixed(1)}
                  </Badge>
                  <span className="text-muted-foreground">{r.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground/70">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {result.disclaimer}
        </p>
      </CardContent>
    </Card>
  );
}
