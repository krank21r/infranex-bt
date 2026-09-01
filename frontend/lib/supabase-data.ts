import { createBrowserClient } from '@supabase/ssr'
import type { Opportunity, UserMiner } from '@/types'
import type { BackendSubnet, BackendSubnetMetrics } from '@/lib/adapters'

type SupabaseClient = ReturnType<typeof createBrowserClient>

let cachedClient: SupabaseClient | null = null
let initTried = false

/**
 * Returns a Supabase browser client if env vars are configured.
 * Returns null when running with the anon placeholders or in SSR.
 */
export function getSupabaseDataClient(): SupabaseClient | null {
  if (typeof window === 'undefined') return null
  if (cachedClient) return cachedClient
  if (initTried) return null
  initTried = true

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  if (key.startsWith('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIjoi')) {
    return null
  }
  try {
    cachedClient = createBrowserClient(url, key)
    return cachedClient
  } catch {
    return null
  }
}

export interface SupabaseConnection {
  configured: boolean
  reachable: boolean | null
  reason?: string
  latencyMs?: number
}

export async function checkSupabaseConnection(): Promise<SupabaseConnection> {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!configured) return { configured: false, reachable: null }
  const sb = getSupabaseDataClient()
  if (!sb) {
    return {
      configured: true,
      reachable: false,
      reason: 'Placeholder credentials detected in env. Set a real anon key.',
    }
  }
  const start = performance.now()
  const { error } = await sb.from('subnets').select('netuid', { count: 'exact', head: true })
  const latencyMs = Math.round(performance.now() - start)
  if (error) {
    return {
      configured: true,
      reachable: false,
      reason: error.message,
      latencyMs,
    }
  }
  return { configured: true, reachable: true, latencyMs }
}

interface OpportunityQuery {
  minScore?: number
  limit?: number
  netuid?: number
}

interface SubnetQuery {
  limit?: number
  netuid?: number
}

/**
 * Fetch opportunity scores directly from Supabase.
 * Joins subnet name in a second query (Supabase REST doesn't expose joins
 * the same way as the JS client when going through fetch — we keep parity
 * by fetching the subnets map once).
 */
export async function fetchOpportunities(
  q: OpportunityQuery = {}
): Promise<Opportunity[]> {
  const sb = getSupabaseDataClient()
  if (!sb) throw new Error('Supabase client not configured')

  let query = sb
    .from('opportunity_scores')
    .select(
      'id, netuid, score, risk_level, confidence, recommended_gpu_name, estimated_monthly_revenue, estimated_monthly_cost, estimated_monthly_profit, currency, explanation, score_model_version, created_at'
    )
    .eq('is_current', true)
    .order('score', { ascending: false })
    .limit(q.limit ?? 50)

  if (typeof q.minScore === 'number') {
    query = query.gte('score', q.minScore)
  }
  if (typeof q.netuid === 'number') {
    query = query.eq('netuid', q.netuid)
  }

  const { data: rows, error } = await query
  if (error) throw new Error(error.message)
  if (!rows || rows.length === 0) return []

  const netuids = Array.from(new Set(rows.map((r: { netuid: number }) => r.netuid)))
  const { data: subnetRows } = await sb
    .from('subnets')
    .select('netuid, name')
    .in('netuid', netuids)
  const subnetMap = new Map<number, string>()
  for (const s of (subnetRows ?? []) as Array<{ netuid: number; name: string | null }>) {
    subnetMap.set(s.netuid, s.name ?? '')
  }

  return rows.map((r: Record<string, unknown>) =>
    adaptOpportunityRowFromDb(r, subnetMap)
  )
}

/**
 * Fetch raw subnet rows directly from Supabase, returning the BackendSubnet
 * shape so existing adapters in `lib/adapters.ts` keep working unchanged.
 */
export async function fetchSubnetsRaw(q: SubnetQuery = {}): Promise<BackendSubnet[]> {
  const sb = getSupabaseDataClient()
  if (!sb) throw new Error('Supabase client not configured')

  let query = sb
    .from('subnets')
    .select(
      'id, netuid, name, description, subnet_type, owner_hotkey, max_neurons, tempo, difficulty, is_active, registration_open, created_at, updated_at'
    )
    .order('netuid', { ascending: true })
    .limit(q.limit ?? 100)

  if (typeof q.netuid === 'number') {
    query = query.eq('netuid', q.netuid)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: (row.id as string | null) ?? null,
    netuid: Number(row.netuid),
    name: (row.name as string | null) ?? '',
    description: (row.description as string | null) ?? null,
    subnet_type: (row.subnet_type as string | null) ?? null,
    owner_hotkey: (row.owner_hotkey as string | null) ?? null,
    max_neurons: (row.max_neurons as number | null) ?? null,
    tempo: (row.tempo as number | null) ?? null,
    difficulty: (row.difficulty as number | null) ?? null,
    is_active: Boolean(row.is_active),
    registration_open: Boolean(row.registration_open),
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
    latest_metrics: null,
  }))
}

export async function fetchSubnetMetrics(netuid: number): Promise<BackendSubnetMetrics | null> {
  const sb = getSupabaseDataClient()
  if (!sb) return null
  const { data, error } = await sb
    .from('subnet_metrics')
    .select('*')
    .eq('netuid', netuid)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return (data ?? null) as BackendSubnetMetrics | null
}

export async function fetchMiners(limit = 50): Promise<UserMiner[]> {
  const sb = getSupabaseDataClient()
  if (!sb) throw new Error('Supabase client not configured')
  const { data, error } = await sb
    .from('miners')
    .select(
      'id, deployment_id, netuid, hotkey_address, coldkey_address, uid, status, uptime_seconds, last_health_check, health_score, started_at, stopped_at, created_at, updated_at'
    )
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row: Record<string, unknown>) => adaptMinerFromDb(row))
}

// --- Adapters from raw DB rows to UI types ---

function deriveRiskLevel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) return 'low'
  if (score >= 45) return 'medium'
  return 'high'
}

function adaptOpportunityRowFromDb(
  row: Record<string, unknown>,
  subnetMap: Map<number, string>
): Opportunity {
  const score = Number(row.score ?? 0)
  const confidence = Number(row.confidence ?? 0)
  const netuid = Number(row.netuid)
  const subnetName = subnetMap.get(netuid) ?? `Subnet ${netuid}`
  const created = (row.created_at as string | null) ?? new Date().toISOString()
  return {
    id: String(row.id ?? netuid),
    subnet_id: String(netuid),
    subnet_name: subnetName,
    subnet_symbol: `α${netuid}`,
    netuid,
    type: 'mining',
    score,
    rank: 0,
    estimated_daily_reward: 0,
    estimated_monthly_reward: Number(row.estimated_monthly_revenue ?? 0),
    estimated_apy: 0,
    required_stake: 0,
    current_stake: 0,
    utilization: 0,
    risk_level:
      (row.risk_level as Opportunity['risk_level'] | null) ?? deriveRiskLevel(score),
    confidence,
    factors: [],
    status: 'active',
    expires_at: '',
    created_at: created,
    updated_at: created,
  }
}

function adaptMinerFromDb(row: Record<string, unknown>): UserMiner {
  const now = new Date().toISOString()
  const netuid = Number(row.netuid ?? 0)
  const uid = Number(row.uid ?? 0)
  const hotkey = String(row.hotkey_address ?? '')
  return {
    id: String(row.id),
    user_id: '',
    name: hotkey
      ? `${hotkey.slice(0, 6)}…α${netuid}-${String(uid).padStart(4, '0')}`
      : `α${netuid}-${String(uid).padStart(4, '0')}`,
    hotkey,
    netuid,
    subnet_name: `Subnet ${netuid}`,
    status: ((row.status as string | null) ?? 'unknown') as UserMiner['status'],
    created_at: (row.created_at as string | null) ?? now,
    updated_at: (row.updated_at as string | null) ?? now,
    total_earnings: 0,
    uptime_percent: Number(row.health_score ?? 0),
    description: undefined,
    tags: undefined,
    on_chain_uid: uid || null,
  }
}