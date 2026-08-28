/**
 * Adapters — transform backend API responses into the existing UI types.
 *
 * The backend's v1.0 scoring engine returns a different shape than the
 * original hard-coded mocks. These adapters normalize the response so the
 * existing components (OpportunityTable, MetricCard, etc.) keep working.
 */
import type { Opportunity, OpportunityFactor, Subnet } from '@/types'

// --- Backend response shapes ---

export interface BackendOpportunityRow {
  id?: string | null
  netuid: number
  total_score?: number
  score?: number
  model_version?: string
  explanation?: string
  calculated_at?: string
  created_at?: string
}

export interface BackendScoreComponent {
  name: string
  score: number
  weight: number
  weighted: number
  explanation: string
}

export interface BackendOpportunityDetail {
  netuid: number
  total_score: number
  model_version: string
  components: BackendScoreComponent[]
  summary: string
  subnet_name?: string
}

export interface BackendSubnet {
  id: string | null
  netuid: number
  name: string
  description: string | null
  subnet_type: string | null
  owner_hotkey: string | null
  max_neurons: number | null
  tempo: number | null
  difficulty: number | null
  is_active: boolean
  registration_open: boolean
  created_at: string | null
  updated_at: string | null
  latest_metrics?: BackendSubnetMetrics | null
}

export interface BackendSubnetMetrics {
  netuid: number
  block: number | null
  emission: number | null
  average_incentive: number | null
  total_stake: number | null
  top_5_concentration: number | null
  miner_count: number | null
  validator_count: number | null
  trust: number | null
  consensus: number | null
  recorded_at: string | null
}

// --- Mapping tables ---

const COMPONENT_LABELS: Record<string, string> = {
  economic_potential: 'Economic Potential',
  competition: 'Competition',
  reward_stability: 'Reward Stability',
  market_conditions: 'Market Conditions',
  new_miner_accessibility: 'New Miner Accessibility',
  network_health: 'Network Health',
  hardware_suitability: 'Hardware Suitability',
  profitability_potential: 'Profitability Potential',
}

function deriveRiskLevel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) return 'low'
  if (score >= 45) return 'medium'
  return 'high'
}

function deriveFactors(components: BackendScoreComponent[]): OpportunityFactor[] {
  return (components ?? []).map((c) => ({
    name: COMPONENT_LABELS[c.name] ?? c.name,
    value: c.weighted,
    weight: c.weight,
    impact: c.score >= 60 ? 'positive' : c.score <= 40 ? 'negative' : 'neutral',
    description: c.explanation ?? '',
  }))
}

// --- Adapters ---

/** Convert a backend /opportunities/{netuid} (live computed) to the UI shape. */
export function adaptOpportunityDetail(
  b: BackendOpportunityDetail
): Opportunity {
  const score = Number(b.total_score ?? 0)
  return {
    id: String(b.netuid),
    subnet_id: String(b.netuid),
    subnet_name: b.subnet_name ?? `Subnet ${b.netuid}`,
    subnet_symbol: `α${b.netuid}`,
    netuid: b.netuid,
    type: 'mining',
    score,
    rank: 0,
    estimated_daily_reward: 0,
    estimated_monthly_reward: 0,
    estimated_apy: 0,
    required_stake: 0,
    current_stake: 0,
    utilization: 0,
    risk_level: deriveRiskLevel(score),
    confidence: score / 100,
    factors: deriveFactors(b.components ?? []),
    status: 'active',
    expires_at: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

/** Convert a backend /opportunities list row to the UI shape. */
export function adaptOpportunityRow(b: BackendOpportunityRow): Opportunity {
  const score = Number(b.score ?? b.total_score ?? 0)
  return {
    id: String(b.netuid),
    subnet_id: String(b.netuid),
    subnet_name: `Subnet ${b.netuid}`,
    subnet_symbol: `α${b.netuid}`,
    netuid: b.netuid,
    type: 'mining',
    score,
    rank: 0,
    estimated_daily_reward: 0,
    estimated_monthly_reward: 0,
    estimated_apy: 0,
    required_stake: 0,
    current_stake: 0,
    utilization: 0,
    risk_level: deriveRiskLevel(score),
    confidence: score / 100,
    factors: [],
    status: 'active',
    expires_at: '',
    created_at: b.calculated_at ?? b.created_at ?? new Date().toISOString(),
    updated_at: b.calculated_at ?? b.created_at ?? new Date().toISOString(),
  }
}

/** Convert a backend /subnets row to the UI Subnet shape. */
export function adaptSubnet(b: BackendSubnet): Subnet {
  const m = b.latest_metrics ?? null
  return {
    id: b.id ?? String(b.netuid),
    netuid: b.netuid,
    name: b.name,
    symbol: `α${b.netuid}`,
    description: b.description ?? '',
    owner: b.owner_hotkey ?? '',
    tempo: b.tempo ?? 0,
    blocks_per_epoch: 0,
    emission: m?.emission ?? 0,
    alpha_in: 0,
    alpha_out: 0,
    alpha_total: 0,
    tao_in: 0,
    tao_out: 0,
    tao_total: m?.total_stake ?? 0,
    price: 0,
    market_cap: 0,
    volume_24h: 0,
    change_24h: 0,
    miners_count: m?.miner_count ?? 0,
    validators_count: m?.validator_count ?? 0,
    status: b.is_active ? 'active' : 'inactive',
    created_at: b.created_at ?? new Date().toISOString(),
    updated_at: b.updated_at ?? new Date().toISOString(),
  }
}
