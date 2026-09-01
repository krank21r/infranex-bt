'use client'

import { useEffect, useState } from 'react'
import {
  checkSupabaseConnection,
  getSupabaseDataClient,
} from '@/lib/supabase-data'

export type DataSource = 'supabase-direct' | 'backend-api' | 'unconfigured'

interface UseDataSourceResult {
  source: DataSource
  ready: boolean
  latencyMs?: number
  reason?: string
}

/**
 * Detect which data path the UI should use.
 *  - 'supabase-direct'  — env vars configured + anon read succeeded
 *  - 'backend-api'      — env vars not configured or anon read failed; UI will
 *                          fall back to the existing backend REST endpoints
 *  - 'unconfigured'     — neither is available
 */
export function useDataSource(): UseDataSourceResult {
  const [state, setState] = useState<UseDataSourceResult>({
    source: 'backend-api',
    ready: false,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sb = getSupabaseDataClient()
      if (!sb) {
        if (!cancelled) {
          setState({ source: 'backend-api', ready: true })
        }
        return
      }
      const result = await checkSupabaseConnection()
      if (cancelled) return
      if (result.reachable) {
        setState({
          source: 'supabase-direct',
          ready: true,
          latencyMs: result.latencyMs,
        })
      } else {
        setState({
          source: 'backend-api',
          ready: true,
          reason: result.reason,
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}