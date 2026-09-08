"use client";

import { useNetwork } from "@/lib/infranex/use-network";

export function Footer() {
  const { data } = useNetwork();
  const taoUsd = data?.taoPriceUsd;
  const block = data?.blockNumber;
  const isLive = data?.source === "live";

  return (
    <footer className="mt-auto border-t bg-background/60">
      <div className="flex flex-col items-center justify-between gap-3 px-4 py-4 text-xs text-muted-foreground sm:flex-row lg:px-8">
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
        <p className="text-center">
          Bittensor Intelligence &amp; Mining Operations Platform — scores are
          model estimates, not financial advice.
        </p>
        <div className="flex items-center gap-3">
          {block && block > 0 && (
            <span className="mono tabular">
              block{" "}
              <span className="text-foreground/80">
                {block.toLocaleString()}
              </span>
            </span>
          )}
          {taoUsd && taoUsd > 0 ? (
            <span className="mono tabular text-success">
              TAO/USD ${taoUsd.toFixed(2)}
            </span>
          ) : (
            <span className="mono tabular">TAO/USD —</span>
          )}
        </div>
      </div>
    </footer>
  );
}
