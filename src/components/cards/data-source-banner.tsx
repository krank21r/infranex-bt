"use client";

import { Loader2, Zap, WifiOff, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNetwork } from "@/lib/infranex/use-network";

/**
 * Reports the live data source status: connected to the Finney chain,
 * degraded (price-only), or unreachable.
 */
export function DataSourceBanner({ className }: { className?: string }) {
  const { data, isLoading, isFetching } = useNetwork();

  if (isLoading || !data) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border border-border/60 bg-card/40 backdrop-blur-sm px-4 py-2.5 text-xs backdrop-blur",
          className
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-eyebrow text-muted-foreground">
          Connecting to Finney chain…
        </span>
      </div>
    );
  }

  const isLive = data.source === "live";
  const isPartial = data.source === "partial";
  const isError = data.source === "error";

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2 overflow-hidden rounded-xl border px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-6",
        isLive && "border-primary/25 bg-primary/[0.05] glow-soft",
        isPartial && "border-warning/30 bg-warning/[0.05]",
        isError && "border-destructive/30 bg-destructive/[0.05]",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border",
            isLive && "border-primary/40 text-primary",
            isPartial && "border-warning/40 text-warning",
            isError && "border-destructive/40 text-destructive"
          )}
        >
          {isLive ? (
            <Zap className="h-3.5 w-3.5" />
          ) : isError ? (
            <WifiOff className="h-3.5 w-3.5" />
          ) : (
            <Database className="h-3.5 w-3.5" />
          )}
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "pulse-dot",
                isLive && "text-primary",
                isPartial && "text-warning",
                isError && "text-destructive"
              )}
            />
            <span className="text-eyebrow text-foreground/90">
              {isLive
                ? "Live · Finney chain"
                : isPartial
                  ? "Degraded · partial chain read"
                  : "Offline · using last snapshot"}
            </span>
            {data.blockNumber > 0 && (
              <span className="mono text-[10px] uppercase tracking-wider text-muted-foreground">
                block{" "}
                <span className="tabular text-foreground/80">
                  {data.blockNumber.toLocaleString()}
                </span>
              </span>
            )}
            {data.taoPriceUsd > 0 && (
              <span className="mono text-[10px] uppercase tracking-wider text-muted-foreground">
                TAO{" "}
                <span className="tabular text-success">
                  ${data.taoPriceUsd.toFixed(2)}
                </span>
              </span>
            )}
            {isFetching && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLive
              ? `Reading from the live Bittensor Finney chain via JSON-RPC — ${data.totalSubnets} subnets, ${data.subnets.length} tracked, block #${data.blockNumber.toLocaleString()}.`
              : isPartial
                ? "Chain connection is unstable — showing cached subnet values. Retrying every 30s."
                : data.error
                  ? `Chain unreachable: ${data.error}. Showing last known snapshot.`
                  : "No chain data available."}
          </p>
        </div>
      </div>
      <span className="text-eyebrow text-muted-foreground/70">
        {isFetching ? "syncing…" : "synced"} · v1.1
      </span>
    </div>
  );
}
