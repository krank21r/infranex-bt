"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BellRing, Plus, Trash2, Power, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * TIER4 — External alerting panel. Webhook channels (generic / Slack /
 * Discord) that receive trigger events as the engine commits them, plus an
 * optional hourly fleet digest. Mutations are admin-only server-side; the
 * panel surfaces the 403 as a hint rather than hiding the form.
 */

interface ChannelDTO {
  id: string;
  name: string;
  kind: string;
  urlHint: string;
  minSeverity: string;
  digest: boolean;
  enabled: boolean;
  lastStatus: string | null;
  lastError: string | null;
  lastSentAt: string | null;
  sentCount: number;
  failCount: number;
}

const KINDS = ["generic", "slack", "discord"] as const;

export function AlertsPanel() {
  const [channels, setChannels] = useState<ChannelDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("slack");
  const [url, setUrl] = useState("");
  const [minSeverity, setMinSeverity] = useState<string>("critical");
  const [digest, setDigest] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts/channels", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `load failed (${res.status})`);
      setChannels(j.channels ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch("/api/alerts/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, url, minSeverity, digest }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `create failed (${res.status})`);
      setName("");
      setUrl("");
      setDigest(false);
      setNote(`Channel "${name}" created — new ${minSeverity}+ events are forwarded immediately.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, enabled: boolean) => {
    setBusy(true);
    try {
      await fetch(`/api/alerts/channels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/alerts/channels/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? `delete failed (${res.status})`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const test = async (id: string) => {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/channels/${id}/test`, { method: "POST" });
      const j = await res.json();
      if (j?.ok) setNote("Test delivered — check the channel for the payload.");
      else setError(j?.error ?? "Test delivery failed — check the URL and channel config.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-border/60 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" aria-hidden />
            External alerting
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
              webhooks
            </Badge>
          </span>
          <span className="mono text-[10px] font-normal text-muted-foreground/60">
            new events dispatch at commit time · URLs encrypted at rest
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Every NEW trigger event (probe fail, escalation, runway T-minus…) is POSTed to the enabled
          channels at or above their severity gate — Slack and Discord get native payloads. The hourly
          digest is opt-in per channel. Admin-only to manage.
        </p>

        {channels.length > 0 && (
          <ul className="space-y-1.5">
            {channels.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/40 bg-background/30 px-2.5 py-1.5"
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 shrink-0 px-1.5 text-[10px]",
                    !c.enabled
                      ? "border-border/60 bg-muted/30 text-muted-foreground"
                      : c.lastStatus === "ok"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                        : c.lastStatus === "error"
                          ? "border-red-500/40 bg-red-500/10 text-red-300"
                          : "border-sky-500/40 bg-sky-500/10 text-sky-300"
                  )}
                >
                  {!c.enabled ? "off" : (c.lastStatus ?? "new")}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {c.name}
                  <span className="mono ml-1.5 text-[10px] text-muted-foreground/70">
                    {c.kind} · ≥{c.minSeverity}
                    {c.digest ? " · digest" : ""} · {c.sentCount} sent
                    {c.failCount ? ` · ${c.failCount} fail` : ""}
                  </span>
                </span>
                <button
                  aria-label={`Test ${c.name}`}
                  title="Send a test payload"
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  disabled={busy}
                  onClick={() => test(c.id)}
                >
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  aria-label={c.enabled ? `Disable ${c.name}` : `Enable ${c.name}`}
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  disabled={busy}
                  onClick={() => toggle(c.id, !c.enabled)}
                >
                  <Power className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  aria-label={`Delete ${c.name}`}
                  className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  disabled={busy}
                  onClick={() => remove(c.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
                {c.lastError && (
                  <span className="mono w-full truncate text-[10px] text-red-300/80">
                    last error: {c.lastError}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Create channel */}
        <div className="space-y-2 rounded-lg border border-dashed border-border/50 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
            <Plus className="h-3 w-3" aria-hidden />
            New channel
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name — e.g. ops-slack"
              className="h-8 text-xs"
              maxLength={80}
            />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.slack.com/… or any webhook URL"
              className="h-8 text-xs"
              type="url"
            />
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">
                    {k === "generic" ? "generic (JSON {text, event})" : k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={minSeverity} onValueChange={setMinSeverity}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Min severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warning" className="text-xs">warning and above</SelectItem>
                <SelectItem value="critical" className="text-xs">critical only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex h-6 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={digest}
              onChange={(e) => setDigest(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            also receive the hourly fleet digest
          </label>
          <Button
            size="sm"
            className="h-7 gap-1 px-2.5 text-xs"
            disabled={busy || name.trim().length < 2 || url.trim().length < 8}
            onClick={create}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add channel
          </Button>
        </div>

        {loading && <p className="text-xs text-muted-foreground">Loading channels…</p>}
        {note && <p className="text-[11px] text-foreground/85">{note}</p>}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
