import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(
  num: number,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
    ...options,
  }).format(num);
}

export function formatCurrency(amount: number, currency = "USD"): string {
  if (currency === "TAO") {
    return `${amount.toFixed(4)} TAO`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatTao(amount: number): string {
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount)} TAO`;
}

export function formatPercent(value: number, decimals = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

export function formatPercentPlain(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function formatRelativeTime(date: Date | string): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface StatusColor {
  bg: string;
  text: string;
  dot: string;
}

export function getStatusColor(status: string | null | undefined): StatusColor {
  const colors: Record<string, StatusColor> = {
    active: { bg: "bg-success/10", text: "text-success", dot: "bg-success" },
    pending: { bg: "bg-warning/10", text: "text-warning", dot: "bg-warning" },
    inactive: {
      bg: "bg-muted/50",
      text: "text-muted-foreground",
      dot: "bg-muted-foreground",
    },
    error: {
      bg: "bg-destructive/10",
      text: "text-destructive",
      dot: "bg-destructive",
    },
    warning: { bg: "bg-warning/10", text: "text-warning", dot: "bg-warning" },
    success: { bg: "bg-success/10", text: "text-success", dot: "bg-success" },
    running: { bg: "bg-primary/10", text: "text-primary", dot: "bg-primary" },
    stopped: {
      bg: "bg-muted/50",
      text: "text-muted-foreground",
      dot: "bg-muted-foreground",
    },
    low: { bg: "bg-success/10", text: "text-success", dot: "bg-success" },
    medium: { bg: "bg-warning/10", text: "text-warning", dot: "bg-warning" },
    high: { bg: "bg-destructive/10", text: "text-destructive", dot: "bg-destructive" },
  };
  if (!status) return colors.inactive;
  return colors[status.toLowerCase()] || colors.inactive;
}

export function calculateChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return `${str.slice(0, length)}…`;
}

export function shortAddress(addr: string, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function scoreBand(score: number): {
  label: "RUN" | "WATCH" | "AVOID";
  color: string;
  bg: string;
} {
  if (score >= 75)
    return { label: "RUN", color: "text-success", bg: "bg-success/10" };
  if (score >= 40)
    return { label: "WATCH", color: "text-warning", bg: "bg-warning/10" };
  return { label: "AVOID", color: "text-destructive", bg: "bg-destructive/10" };
}
