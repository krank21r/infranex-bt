'use client'

import { useEffect } from 'react'
import { Database, Loader2, ShieldAlert, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDataSource, type DataSource } from '@/hooks/useDataSource'

const META: Record<
  DataSource,
  { label: string; tone: 'live' | 'fallback' | 'unconfigured'; description: string }
> = {
  'supabase-direct': {
    label: 'Supabase direct',
    tone: 'live',
    description: 'Queries bypass the backend and read straight from Postgres.',
  },
  'backend-api': {
    label: 'Backend API',
    tone: 'fallback',
    description: 'Routing through /api on the Vercel app.',
  },
  unconfigured: {
    label: 'No data source',
    tone: 'unconfigured',
    description: 'No Supabase env vars and no backend URL configured.',
  },
}

export function DataSourceBanner({
  className,
}: {
  className?: string
}) {
  const { source, ready, latencyMs, reason } = useDataSource()

  if (!ready) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-md border border-border/60 bg-card/30 px-4 py-2 text-xs',
          className
        )}
      >
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        <span className="text-eyebrow text-muted-foreground">
          Probing data source…
        </span>
      </div>
    )
  }

  const meta = META[source]
  const isLive = meta.tone === 'live'
  const isFallback = meta.tone === 'fallback'

  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 overflow-hidden rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6',
        isLive && 'border-primary/30 bg-primary/[0.04]',
        isFallback && 'border-warning/30 bg-warning/[0.05]',
        meta.tone === 'unconfigured' && 'border-destructive/30 bg-destructive/[0.05]',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-6 w-6 items-center justify-center rounded-md border',
            isLive && 'border-primary/40 text-primary',
            isFallback && 'border-warning/40 text-warning',
            meta.tone === 'unconfigured' && 'border-destructive/40 text-destructive'
          )}
        >
          {isLive ? (
            <Zap className="h-3.5 w-3.5" />
          ) : meta.tone === 'unconfigured' ? (
            <ShieldAlert className="h-3.5 w-3.5" />
          ) : (
            <Database className="h-3.5 w-3.5" />
          )}
        </span>
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'pulse-dot',
                isLive && 'text-primary',
                isFallback && 'text-warning',
                meta.tone === 'unconfigured' && 'text-destructive'
              )}
            />
            <span className="text-eyebrow text-foreground/90">{meta.label}</span>
            {typeof latencyMs === 'number' && (
              <span className="mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {latencyMs} ms
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {meta.description}
            {reason ? (
              <span className="ml-1 text-destructive/80">— {reason}</span>
            ) : null}
          </p>
        </div>
      </div>
      <span className="text-eyebrow text-muted-foreground/70">
        v1.0 · read path
      </span>
    </div>
  )
}

export function useTrackDataSourceReady(cb: (source: DataSource) => void) {
  const { source, ready } = useDataSource()
  useEffect(() => {
    if (ready) cb(source)
  }, [ready, source, cb])
}