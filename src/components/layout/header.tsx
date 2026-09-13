"use client";

import { useState, useEffect } from "react";
import { Bell, LogOut, Moon, Sun, Wifi, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { useTriggers } from "@/lib/infranex/use-triggers";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { TriggerEventDTO } from "@/lib/infranex/use-triggers";

interface HeaderProps {
  onMenuClick: () => void;
  title: string;
  eyebrow: string;
}

interface SessionUser {
  userId: string;
  label: string;
  role: string;
}

export function Header({ onMenuClick, title, eyebrow }: HeaderProps) {
  const [time, setTime] = useState<Date | null>(null);
  const [isDark, setIsDark] = useState(false);

  // AUTH-1 — the signed-in operator (the proxy guarantees the session exists).
  const { data: session } = useQuery<{ user: SessionUser }>({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) throw new Error("not signed in");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const user = session?.user;

  // WINDUP-1: the bell now shows REAL open trigger findings (was: three
  // hardcoded demo notifications + a fake "3 new" badge on a live ops
  // surface — misleading during real incidents). Same cached query the
  // Trigger Center uses, so this adds no extra polling.
  const { data: trig } = useTriggers();
  const openEvents: TriggerEventDTO[] = (trig?.open ?? []).slice(0, 3);
  const openCount = trig?.open?.length ?? 0;
  const initials = (user?.label || user?.userId || "OP")
    .replace(/[^a-zA-Z0-9]/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // clear locally regardless — the proxy will bounce to /login
    }
    window.location.replace("/login");
  };

  useEffect(() => {
    // Defer initial sync to a microtask to avoid setState-in-effect warning.
    void Promise.resolve().then(() => {
      setTime(new Date());
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    const next = !html.classList.contains("dark");
    html.classList.toggle("dark", next);
    setIsDark(next);
    try {
      localStorage.setItem("infranex-theme", next ? "dark" : "light");
    } catch {
      // storage unavailable — theme simply won't persist
    }
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });

  const formatDate = (date: Date) =>
    date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

  return (
    <header className="sticky top-0 z-30 h-16 border-b border-border/60 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center justify-between gap-3 px-4 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden rounded-lg"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <p className="text-eyebrow text-muted-foreground/80 truncate">{eyebrow}</p>
            <h2 className="text-display truncate text-lg font-bold leading-tight">
              {title}
            </h2>
          </div>
        </div>

        <div className="hidden items-center md:flex md:flex-1 md:justify-center md:max-w-sm">
          <div className="group relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input
              placeholder="Search subnets, netuid, miners…"
              className="h-9 rounded-lg border-border/60 bg-card/50 pl-9 pr-12 text-sm transition-colors placeholder:text-muted-foreground/60 focus:border-primary/40"
              aria-label="Search"
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 mono text-[10px] font-medium text-muted-foreground lg:flex">
              ⌘K
            </kbd>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Network status">
                  <div className="relative flex h-5 w-5 items-center justify-center">
                    <Wifi className="h-4 w-4 text-success" />
                    <span className="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full bg-success" />
                  </div>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">All systems operational</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                >
                  {isDark ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <Moon className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isDark ? "Switch to light" : "Switch to dark"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-9 w-9"
                aria-label="Notifications"
              >
                <Bell className="h-5 w-5" />
                {openCount > 0 && (
                  <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Open findings</span>
                <Badge variant="outline" className="text-xs">
                  {openCount} open
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {openEvents.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  All clear — no open trigger findings.
                </div>
              ) : (
                openEvents.map((e) => (
                  <DropdownMenuItem key={e.id} className="flex flex-col items-start gap-1 py-2">
                    <div className="flex w-full items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          e.severity === "critical" && "bg-destructive",
                          e.severity === "warning" && "bg-amber-400",
                          e.severity !== "critical" && e.severity !== "warning" && "bg-primary"
                        )}
                      />
                      <span className="truncate text-sm font-medium">{e.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(e.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {e.kind}
                      {e.netuid !== null ? ` · α${e.netuid}` : ""}
                    </p>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="mx-1 h-6" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                <Avatar className="h-9 w-9 border">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">
                    {user?.label || "Signed in"}
                  </p>
                  <p className="mono text-xs leading-none text-muted-foreground">
                    {user?.userId || "…"}
                  </p>
                  {user?.role && user.role !== "member" && (
                    <Badge variant="outline" className="mt-1 w-fit text-[10px] uppercase tracking-wide">
                      {user.role}
                    </Badge>
                  )}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={logout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="hidden flex-col items-end lg:flex">
            <p className="text-[11px] text-muted-foreground">
              {time ? formatDate(time) : "\u00A0"}
            </p>
            <p className="mono tabular rounded-md border border-border/50 bg-card/50 px-1.5 py-0.5 text-[11px] text-foreground/90">
              {time ? formatTime(time) : "\u00A0"}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
