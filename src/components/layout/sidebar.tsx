"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useNetwork } from "@/lib/infranex/use-network";
import {
  LayoutDashboard,
  TrendingUp,
  Network,
  Cpu,
  Coins,
  BarChart3,
  Activity,
  X,
  AlertTriangle,
  Rocket,
  Gauge,
} from "lucide-react";
import type { ViewKey } from "@/lib/infranex/types";

const NAV: { key: ViewKey; label: string; icon: typeof LayoutDashboard; hint: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, hint: "01" },
  { key: "opportunities", label: "Opportunities", icon: TrendingUp, hint: "02" },
  { key: "subnets", label: "Subnets", icon: Network, hint: "03" },
  { key: "gpus", label: "GPU Catalog", icon: Cpu, hint: "04" },
  { key: "miners", label: "My Miners", icon: Coins, hint: "05" },
  { key: "deployments", label: "Deployments", icon: Rocket, hint: "06" },
  { key: "monitoring", label: "Monitoring", icon: Gauge, hint: "07" },
  { key: "analytics", label: "Analytics", icon: BarChart3, hint: "08" },
  { key: "system", label: "System & Errors", icon: AlertTriangle, hint: "09" },
];

interface SidebarProps {
  current: ViewKey;
  onNavigate: (v: ViewKey) => void;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function Sidebar({
  current,
  onNavigate,
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const handleNav = (v: ViewKey) => {
    onNavigate(v);
    onMobileOpenChange(false);
  };

  const NavList = (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = current === item.key;
        return (
          <button
            key={item.key}
            onClick={() => handleNav(item.key)}
            className={cn("sidebar-link group", active && "active")}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 text-left">{item.label}</span>
            <span className="mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
              {item.hint}
            </span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-sidebar lg:flex">
        <SidebarBrand />
        <ScrollArea className="flex-1 px-3 py-4 custom-scroll">
          <p className="text-eyebrow px-3 pb-2 text-muted-foreground/70">
            Intelligence
          </p>
          {NavList}
          <div className="mt-6 px-3">
            <div className="editorial-rule" />
          </div>
          <SidebarFooter />
        </ScrollArea>
      </aside>

      {/* Mobile */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="w-72 border-r bg-sidebar p-0">
          <div className="flex items-center justify-between pr-4">
            <SidebarBrand />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onMobileOpenChange(false)}
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1 px-3 py-4 custom-scroll">
            <p className="text-eyebrow px-3 pb-2 text-muted-foreground/70">
              Intelligence
            </p>
            {NavList}
            <div className="mt-6 px-3">
              <div className="editorial-rule" />
            </div>
            <SidebarFooter />
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SidebarBrand() {
  return (
    <div className="flex h-16 items-center gap-2.5 border-b px-5">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-md border border-primary/40 bg-primary/10">
        <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
      </div>
      <div className="leading-none">
        <p className="text-display text-base font-semibold tracking-tight">
          Infranex
          <span className="text-primary"> BT</span>
        </p>
        <p className="mono text-[10px] uppercase tracking-wider text-muted-foreground">
          subnet intelligence
        </p>
      </div>
    </div>
  );
}

function SidebarFooter() {
  const { data } = useNetwork();
  const isLive = data?.source === "live";
  const block = data?.blockNumber ?? 0;
  const totalSubnets = data?.totalSubnets ?? 0;
  return (
    <div className="mt-auto px-3 pt-6">
      <div className="rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="flex items-center gap-2">
          <span
            className={
              isLive
                ? "pulse-dot text-success"
                : "h-2 w-2 rounded-full bg-warning"
            }
          />
          <span className="text-eyebrow text-foreground/90">
            {isLive ? "Chain synced" : "Syncing…"}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Finney · block{" "}
          <span className="mono tabular text-foreground/80">
            {block > 0 ? block.toLocaleString() : "—"}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {totalSubnets > 0 ? `${totalSubnets} subnets` : "—"} ·{" "}
          <span className="mono tabular text-success">
            {data?.taoPriceUsd ? `$${data.taoPriceUsd.toFixed(2)}` : "—"}
          </span>
        </p>
      </div>
    </div>
  );
}

export { SheetTrigger };
