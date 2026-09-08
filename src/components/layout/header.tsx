"use client";

import { useState, useEffect } from "react";
import { Bell, Moon, Sun, Wifi, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

interface HeaderProps {
  onMenuClick: () => void;
  title: string;
  eyebrow: string;
}

export function Header({ onMenuClick, title, eyebrow }: HeaderProps) {
  const [time, setTime] = useState<Date | null>(null);
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    // Defer initial sync to a microtask to avoid setState-in-effect warning.
    void Promise.resolve().then(() => setTime(new Date()));
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    const html = document.documentElement;
    const next = html.classList.contains("light");
    if (next) {
      html.classList.remove("light");
      html.classList.add("dark");
      setIsLight(false);
    } else {
      html.classList.remove("dark");
      html.classList.add("light");
      setIsLight(true);
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
    <header className="sticky top-0 z-30 h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center justify-between gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onMenuClick}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <p className="text-eyebrow text-muted-foreground truncate">{eyebrow}</p>
            <h2 className="text-display truncate text-lg font-semibold leading-tight">
              {title}
            </h2>
          </div>
        </div>

        <div className="hidden items-center md:flex md:flex-1 md:justify-center md:max-w-sm">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search subnets, netuid, miners…"
              className="h-9 pl-9 bg-card/40"
              aria-label="Search"
            />
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
                  {isLight ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <Moon className="h-5 w-5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isLight ? "Switch to dark" : "Switch to light"}
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
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-destructive" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel className="flex items-center justify-between">
                <span>Notifications</span>
                <Badge variant="outline" className="text-xs">
                  3 new
                </Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-2">
                <div className="flex w-full items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  <span className="text-sm font-medium">Miner registered</span>
                  <span className="ml-auto text-xs text-muted-foreground">2m</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  apex-prod-01 joined Subnet 7 · Apex
                </p>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-2">
                <div className="flex w-full items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-warning" />
                  <span className="text-sm font-medium">GPU catalog degraded</span>
                  <span className="ml-auto text-xs text-muted-foreground">18m</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  RunPod H100 offers temporarily unavailable
                </p>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex flex-col items-start gap-1 py-2">
                <div className="flex w-full items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  <span className="text-sm font-medium">Score updated</span>
                  <span className="ml-auto text-xs text-muted-foreground">5m</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Subnet 23 · Mosaic now ranks #1 (88.4)
                </p>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="mx-1 h-6" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                <Avatar className="h-9 w-9 border">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                    OP
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">Operator</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    operator@infranex.bt
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuItem>API keys</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive">
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="hidden flex-col items-end lg:flex">
            <p className="text-xs text-muted-foreground">
              {time ? formatDate(time) : "\u00A0"}
            </p>
            <p className="mono tabular text-xs text-foreground/80">
              {time ? formatTime(time) : "\u00A0"}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
