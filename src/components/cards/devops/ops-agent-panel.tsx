"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { BrainCircuit, Loader2, Send } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";

/**
 * TIER4 — AI Ops Agent panel. One LLM analysis over the live fleet digest,
 * persisted and listed. The agent only ADVISES — execution stays with the
 * approval-gated trigger pipeline / autopilot policy engine.
 */

interface AgentNoteDTO {
  id: string;
  question: string | null;
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export function OpsAgentPanel() {
  const [notes, setNotes] = useState<AgentNoteDTO[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/devops/agent", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `load failed (${res.status})`);
      setNotes(j.notes ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/devops/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? `agent run failed (${res.status})`);
      setNotes((n) => [j.note as AgentNoteDTO, ...n].slice(0, 10));
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent run failed");
    } finally {
      setBusy(false);
    }
  };

  const latest = notes[0];

  return (
    <Card className="border-border/60 bg-card/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-primary" aria-hidden />
            Ops Agent
            <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-muted-foreground">
              advises · never executes
            </Badge>
          </span>
          <span className="mono text-[10px] font-normal text-muted-foreground/60">
            LLM analysis of the live fleet digest
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Reads the whole fleet — vitals, open events, economics — and returns a ranked
          situation report. Recommendations tagged <span className="mono text-[11px]">[auto-safe]</span> can
          ride the autopilot policy engine; <span className="mono text-[11px]">[needs-approval]</span> lands in the inbox below.
        </p>

        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask the fleet something — e.g. why is monitor-demo-01 losing money?"
            className="h-8 text-xs"
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void run();
            }}
          />
          <Button
            size="sm"
            className="h-8 shrink-0 gap-1.5"
            disabled={busy}
            onClick={run}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden />
            )}
            Analyze
          </Button>
        </div>

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading notes…</p>
        ) : latest ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-border/50 bg-background/40 p-3">
              <p className="text-eyebrow text-muted-foreground/70">
                {latest.question ? `Q: ${latest.question}` : "Fleet situation"} ·{" "}
                {formatRelativeTime(latest.createdAt)}
                {typeof latest.meta?.latencyMs === "number"
                  ? ` · ${(latest.meta.latencyMs / 1000).toFixed(1)}s`
                  : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                {latest.content}
              </p>
            </div>
            {notes.length > 1 && (
              <div>
                <p className="text-eyebrow text-muted-foreground/70">Earlier analyses</p>
                <ul className="mt-1 space-y-1">
                  {notes.slice(1).map((n) => (
                    <li
                      key={n.id}
                      className="flex items-center gap-2 rounded-md border border-border/40 bg-background/30 px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      <BrainCircuit className="h-3 w-3 shrink-0 text-primary/60" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        {n.question ?? n.content.split("\n")[0]?.slice(0, 80) ?? "Fleet analysis"}
                      </span>
                      <span className="mono shrink-0 text-[10px] text-muted-foreground/60">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className={cn("rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground")}>
            No analyses yet — press Analyze for the first fleet report.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
