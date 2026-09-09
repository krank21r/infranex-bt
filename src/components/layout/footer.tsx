"use client";

import { useNetwork } from "@/lib/infranex/use-network";

export function Footer() {
  const { data } = useNetwork();
  const taoUsd = data?.taoPriceUsd;
  const block = data?.blockNumber;
  const isLive = data?.source === "live";

  return (
    <footer className="mt-auto border-t border-border/60 bg-background/60 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground sm:flex-row lg:px-8">
        <div className="flex items-center gap-2">
          <span
            className={
              isLive
                ? "pulse-dot text-success"
                : "h-2 w-2 rounded-full bg-muted-foreground"
            }
          />
          <span className="text-eyebrow">
            Infranex BT · v1.1 · {isLive ? "live read path" : "snapshot mode"}
          </span>
        </div>
        <p className="text-center text-[11px] text-muted-foreground/80">
          Bittensor Intelligence &amp; Mining Operations Platform — scores are
          model estimates, not financial advice.
        </p>
        <div className="flex items-center gap-2">
          {block && block > 0 && (
            <span className="mono tabular rounded-md border border-border/50 bg-card/50 px-2 py-1">
              block{" "}
              <span className="text-foreground/90">
                {block.toLocaleString()}
              </span>
            </span>
          )}
          {taoUsd && taoUsd > 0 ? (
            <span className="mono tabular rounded-md border border-success/20 bg-success/10 px-2 py-1 text-success">
              TAO/USD ${taoUsd.toFixed(2)}
            </span>
          ) : (
            <span className="mono tabular rounded-md border border-border/50 bg-card/50 px-2 py-1">TAO/USD —</span>
          )}
        </div>
      </div>
    </footer>
  );
}
