export interface Subnet {
  id: string
  netuid: number
  name: string
  symbol: string
  description: string
  owner: string
  tempo: number
  blocks_per_epoch: number
  emission: number
  alpha_in: number
  alpha_out: number
  alpha_total: number
  tao_in: number
  tao_out: number
  tao_total: number
  price: number
  market_cap: number
  volume_24h: number
  change_24h: number
  miners_count: number
  validators_count: number
  status: 'active' | 'inactive' | 'pending'
  created_at: string
  updated_at: string
  metadata?: SubnetMetadata
}

export interface SubnetMetadata {
  website?: string
  twitter?: string
  discord?: string
  github?: string
  documentation?: string
  category?: string
  tags?: string[]
}

export interface Opportunity {
  id: string
  subnet_id: string
  subnet_name: string
  subnet_symbol: string
  netuid: number
  type: 'mining' | 'validating' | 'staking' | 'trading'
  score: number
  rank: number
  estimated_daily_reward: number
  estimated_monthly_reward: number
  estimated_apy: number
  required_stake: number
  current_stake: number
  utilization: number
  risk_level: 'low' | 'medium' | 'high'
  confidence: number
  factors: OpportunityFactor[]
  status: 'active' | 'pending' | 'expired'
  expires_at: string
  created_at: string
  updated_at: string
}

export interface OpportunityFactor {
  name: string
  value: number
  weight: number
  impact: 'positive' | 'negative' | 'neutral'
  description: string
}

export interface Miner {
  id: string
  hotkey: string
  coldkey: string
  subnet_id: string
  netuid: number
  rank: number
  stake: number
  emission: number
  dividends: number
  incentive: number
  trust: number
  consensus: number
  validator_trust: number
  last_update: string
  status: 'active' | 'inactive' | 'deregistered'
  performance: MinerPerformance
}

export interface MinerPerformance {
  daily_rewards: number[]
  weekly_rewards: number[]
  uptime: number
  blocks_mined: number
  blocks_validated: number
  average_rank: number
}

export interface AnalyticsData {
  total_subnets: number
  active_subnets: number
  total_market_cap: number
  total_volume_24h: number
  total_miners: number
  total_validators: number
  average_apy: number
  top_opportunities: Opportunity[]
  revenue_data: RevenuePoint[]
  emission_data: EmissionPoint[]
}

export interface RevenuePoint {
  timestamp: string
  subnet_id: string
  subnet_name: string
  netuid: number
  tao_revenue: number
  usd_revenue: number
  miners_count: number
}

export interface EmissionPoint {
  timestamp: string
  subnet_id: string
  subnet_name: string
  netuid: number
  total_emission: number
  alpha_emission: number
  tao_emission: number
}

export interface ChartDataPoint {
  name: string
  value: number
  [key: string]: string | number
}

export interface TimeSeriesData {
  timestamp: string
  value: number
}

export interface TableColumn<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  width?: string
  align?: 'left' | 'center' | 'right'
}

export interface PaginationParams {
  page: number
  limit: number
  sort?: string
  order?: 'asc' | 'desc'
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface FilterParams {
  search?: string
  status?: string
  type?: string
  minScore?: number
  maxScore?: number
  minApy?: number
  maxApy?: number
  riskLevel?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface User {
  id: string
  email: string
  name: string
  avatar_url?: string
  role: 'admin' | 'user' | 'viewer'
  preferences: UserPreferences
  created_at: string
  updated_at: string
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  currency: 'USD' | 'TAO'
  notifications: boolean
  autoRefresh: boolean
  refreshInterval: number
  compactMode: boolean
}

export interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  read: boolean
  created_at: string
  action_url?: string
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy'
  timestamp: string
  services: ServiceHealth[]
}

export interface ServiceHealth {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  latency_ms: number
  last_check: string
  details?: Record<string, unknown>
}

export interface WebSocketMessage<T = unknown> {
  type: string
  payload: T
  timestamp: string
}