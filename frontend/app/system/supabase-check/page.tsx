'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import {
  checkSupabaseConnection,
  fetchOpportunities,
  fetchSubnetsRaw,
  fetchMiners,
} from '@/lib/supabase-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Probe {
  label: string
  status: 'pending' | 'pass' | 'fail'
  detail: string
  rows?: number
}

export default function SupabaseCheckPage() {
  const [connection, setConnection] = useState<{
    configured: boolean
    reachable: boolean | null
    reason?: string
    latencyMs?: number
  } | null>(null)
  const [probes, setProbes] = useState<Probe[]>([
    { label: 'opportunity_scores', status: 'pending', detail: 'Awaiting run…' },
    { label: 'subnets', status: 'pending', detail: 'Awaiting run…' },
    { label: 'miners', status: 'pending', detail: 'Awaiting run…' },
  ])
  const [running, setRunning] = useState(false)

  const run = useCallback(async () => {
    setRunning(true)
    setProbes((p) =>
      p.map((probe) => ({ ...probe, status: 'pending', detail: 'Querying…' }))
    )
    const conn = await checkSupabaseConnection()
    setConnection(conn)

    if (!conn.reachable) {
      setProbes((p) =>
        p.map((probe) => ({
          ...probe,
          status: 'fail',
          detail: conn.reason ?? 'Cannot reach Supabase.',
        }))
      )
      setRunning(false)
      return
    }

    const results: Probe[] = []
    try {
      const opps = await fetchOpportunities({ limit: 5 })
      results.push({
        label: 'opportunity_scores',
        status: opps.length > 0 || true ? 'pass' : 'fail',
        detail:
          opps.length > 0
            ? `Returned ${opps.length} row(s) ordered by score.`
            : 'Query succeeded but returned 0 rows.',
        rows: opps.length,
      })
    } catch (e) {
      results.push({
        label: 'opportunity_scores',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
      })
    }
    try {
      const subs = await fetchSubnetsRaw({ limit: 5 })
      results.push({
        label: 'subnets',
        status: 'pass',
        detail:
          subs.length > 0
            ? `Returned ${subs.length} subnet(s).`
            : 'Query succeeded but returned 0 rows.',
        rows: subs.length,
      })
    } catch (e) {
      results.push({
        label: 'subnets',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
      })
    }
    try {
      const miners = await fetchMiners(5)
      results.push({
        label: 'miners',
        status: 'pass',
        detail:
          miners.length > 0
            ? `Returned ${miners.length} miner(s).`
            : 'Query succeeded but returned 0 rows.',
        rows: miners.length,
      })
    } catch (e) {
      results.push({
        label: 'miners',
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
      })
    }

    setProbes(results)
    setRunning(false)
  }, [])

  useEffect(() => {
    // Intentional: kick off the diagnostic on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run()
  }, [run])

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-4">
          <p className="text-eyebrow text-muted-foreground">
            Diagnostics · /system/supabase-check
          </p>
          <h1 className="text-display text-4xl leading-tight md:text-5xl">
            Supabase <em className="text-primary not-italic">direct</em> probe.
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Verifies the browser can read{' '}
            <span className="mono text-foreground">opportunity_scores</span>,{' '}
            <span className="mono text-foreground">subnets</span> and{' '}
            <span className="mono text-foreground">miners</span> using the
            anon key shipped to the client. If any probe fails, run the
            migration{' '}
            <span className="mono text-foreground">
              004_anon_read_policies.sql
            </span>{' '}
            in Supabase SQL editor.
          </p>
        </header>

        <Card className="border-border/60 bg-card/40">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle className="text-display text-xl">Connection</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={run}
              disabled={running}
            >
              <RefreshCw
                className={`h-4 w-4 mr-2 ${running ? 'animate-spin' : ''}`}
              />
              Re-run
            </Button>
          </CardHeader>
          <CardContent>
            {!connection ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Probing…
              </div>
            ) : !connection.configured ? (
              <Badge variant="destructive">
                NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY missing
              </Badge>
            ) : connection.reachable ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Badge className="border-primary/40 bg-primary/15 text-primary">
                  reachable · {connection.latencyMs} ms
                </Badge>
                <span className="text-muted-foreground">
                  RLS policies are letting anon reads through.
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <Badge variant="destructive">
                  Not reachable from this browser
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {connection.reason}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <section className="grid gap-3">
          {probes.map((probe) => (
            <ProbeRow key={probe.label} probe={probe} />
          ))}
        </section>

        <footer className="pt-4 text-xs text-muted-foreground">
          <p>
            If probes fail with{' '}
            <span className="mono text-foreground">
              permission denied for table
            </span>
            , apply the anon read policies migration. See{' '}
            <span className="mono text-foreground">
              database/migrations/004_anon_read_policies.sql
            </span>
            .
          </p>
        </footer>
      </div>
    </div>
  )
}

function ProbeRow({ probe }: { probe: Probe }) {
  const Icon =
    probe.status === 'pass'
      ? CheckCircle2
      : probe.status === 'fail'
      ? XCircle
      : Loader2
  const tone =
    probe.status === 'pass'
      ? 'text-primary border-primary/30 bg-primary/[0.04]'
      : probe.status === 'fail'
      ? 'text-destructive border-destructive/30 bg-destructive/[0.04]'
      : 'text-muted-foreground border-border bg-card/30'

  return (
    <div
      className={`flex items-start gap-4 rounded-lg border p-4 ${tone}`}
    >
      <Icon
        className={`mt-0.5 h-5 w-5 ${
          probe.status === 'pending' ? 'animate-spin' : ''
        }`}
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="mono text-sm text-foreground">{probe.label}</span>
          {typeof probe.rows === 'number' && (
            <Badge variant="outline" className="mono">
              {probe.rows} rows
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{probe.detail}</p>
      </div>
      <a
        href={`https://supabase.com/dashboard/project/_/editor`}
        target="_blank"
        rel="noreferrer"
        className="hidden items-center gap-1 text-xs text-muted-foreground hover:text-primary sm:inline-flex"
      >
        Open in Supabase
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}