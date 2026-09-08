"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Client-side error log — a module-level singleton that captures every
 * uncaught error and unhandled promise rejection in the browser, plus
 * a subscribe API so React components can render the log live.
 */

export interface CapturedError {
  id: string;
  type: "error" | "unhandledrejection" | "manual";
  message: string;
  source?: string;
  lineno?: number;
  colno?: number;
  stack?: string;
  timestamp: number;
}

const MAX_ERRORS = 100;
let errors: CapturedError[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

function push(err: Omit<CapturedError, "id" | "timestamp">) {
  const entry: CapturedError = {
    ...err,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  errors = [entry, ...errors].slice(0, MAX_ERRORS);
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (e: ErrorEvent) => {
    push({
      type: "error",
      message: e.message || "Unknown error",
      source: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack,
    });
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    push({
      type: "unhandledrejection",
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "Unhandled promise rejection",
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

export function useErrorLog() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const clear = useCallback(() => {
    errors = [];
    notify();
  }, []);

  const addManual = useCallback((message: string, stack?: string) => {
    push({ type: "manual", message, stack });
  }, []);

  return { errors, clear, addManual };
}
