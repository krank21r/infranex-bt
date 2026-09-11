"use client";

// SeatChance badge — "can I get a slot in this subnet?" at a glance.
// verdicts: open (green) · burn-entry (amber, full but payable) ·
//           waitlist (red, full + competitive) · unknown (gray)

import { Badge } from "@/components/ui/badge";
import { DoorOpen, Flame, Hourglass, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SeatChance } from "@/lib/infranex/miner-score";

const STYLES: Record<
  SeatChance["verdict"],
  { cls: string; icon: React.ReactNode }
> = {
  open: { cls: "border-success/40 text-success bg-success/[0.06]", icon: <DoorOpen className="h-3 w-3" /> },
  "burn-entry": { cls: "border-warning/40 text-warning bg-warning/[0.06]", icon: <Flame className="h-3 w-3" /> },
  waitlist: { cls: "border-destructive/40 text-destructive bg-destructive/[0.06]", icon: <Hourglass className="h-3 w-3" /> },
  unknown: { cls: "border-border text-muted-foreground", icon: <HelpCircle className="h-3 w-3" /> },
};

export function SeatChanceBadge({
  seat,
  className,
}: {
  seat: SeatChance;
  className?: string;
}) {
  const s = STYLES[seat.verdict];
  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] gap-1 cursor-help", s.cls, className)}
      title={`Seat availability — ${seat.detail}`}
    >
      {s.icon}
      <span className="lowercase">seat: {seat.headline}</span>
    </Badge>
  );
}
