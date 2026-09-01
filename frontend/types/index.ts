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
  page?: number
  page_size?: number
  sort_by?: string
  sort_order?: string
  min_score?: number
  is_active?: boolean
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

export interface MonitoringOverview {
  total_miners: number
  active_miners: number
  inactive_miners: number
  down_miners: number
  total_subnets: number
  active_subnets: number
  total_alerts: number
  critical_alerts: number
  warning_alerts: number
  info_alerts: number
  avg_system_health_score: number | null
  total_emission_24h: number | null
  total_incentive_24h: number | null
  miners: MinerHealthSummary[]
  alerts: Alert[]
}

export interface MinerHealthSummary {
  miner_id: string
  status: string
  netuid: number
  hotkey_address: string
  health_score: number | null
  uptime_seconds: number | null
  last_health_check: string | null
  latest_gpu: Record<string, unknown>
  gpu_utilization_avg: number | null
  gpu_temperature_avg: number | null
  emission: number | null
  incentive: number | null
  rank: number | null
  trust: number | null
  active_alerts: number
  recent_errors: string[]
}

export interface SubnetPerformance {
  netuid: number
  miner_count: number
  active_miners: number
  down_miners: number
  avg_health_score: number | null
  avg_gpu_utilization: number | null
  avg_gpu_temperature: number | null
  total_emission: number | null
  total_incentive: number | null
  active_alerts: number
  miners: MinerHealthSummary[]
}

export interface Alert {
  id: string
  alert_type: 'miner_down' | 'low_gpu_utilization' | 'high_temperature' | 'subnet_disconnected' | 'negative_roi'
  severity: 'critical' | 'warning' | 'info'
  message: string
  miner_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  resolved_at: string | null
  is_resolved: boolean
}

// --- GPU Catalog (Phase 5) ---

export interface GPUModel {
  id: string | null
  name: string
  manufacturer: string
  vram_gb: number
  cuda_cores: number | null
  memory_bandwidth_gbps: number | null
  fp16_tflops: number | null
  fp32_tflops: number | null
  tdp_watts: number | null
  generation: string | null
  tier: string | null
}

export interface GPUProvider {
  id: string | null
  name: string
  slug: string
  is_active: boolean
  supports_mock: boolean
}

export interface GPUOffer {
  id: string | null
  provider_id: string | null
  gpu_model_id: string | null
  gpu_model_name?: string | null
  offer_id: string | null
  instance_type: string | null
  region: string | null
  hourly_price: number | null
  monthly_price: number | null
  currency: string | null
  availability: string | null
  vram_gb: number | null
  ram_gb: number | null
  cpu_cores: number | null
  is_spot: boolean | null
}

export interface GpuCatalogParams {
  page?: number
  page_size?: number
  manufacturer?: string
  tier?: string
  min_vram_gb?: number
  provider_id?: string
  gpu_model_id?: string
  region?: string
  max_hourly_price?: number
  is_spot?: boolean
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

export interface GPURequirementInput {
  min_vram_gb?: number | null
  recommended_gpu?: string | null
  cuda_version?: string | null
  [key: string]: unknown
}

export interface RankedGPUOffer {
  offer: GPUOffer
  total_score: number
  match_bonus: number
  region_bonus: number
  price: number
  model_version: string
}

export interface GPURecommendation {
  netuid: number | null
  requirements: GPURequirementInput
  total_eligible: number
  ranked: RankedGPUOffer[]
  model_version: string | null
}

// --- User Miners (Phase 6) ---

export type UserMinerStatus =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'stopped'
  | 'error'
  | 'deregistered'

export interface UserMiner {
  id: string
  user_id: string
  name: string
  hotkey: string
  netuid: number
  subnet_name: string
  status: UserMinerStatus
  created_at: string
  updated_at?: string
  total_earnings: number
  uptime_percent: number
  description?: string
  tags?: string[]
  on_chain_uid?: number | null
}

export interface HotkeyValidationResult {
  valid: boolean
  on_chain: boolean
  uid: number | null
  netuid: number | null
  message: string
}

export interface MinerRegistration {
  name: string
  hotkey: string
  netuid: number
  description?: string
  tags?: string[]
}

export interface MinerUpdate {
  name?: string
  description?: string
  tags?: string[]
  status?: UserMinerStatus
}

// --- Deployments (Phase 11) ---

export type DeploymentStatus =
  | 'requested'
  | 'approved'
  | 'provisioning'
  | 'provisioned'
  | 'setup'
  | 'ready'
  | 'deploying'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'terminated'
  | 'failed'

export type DeploymentStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export type DeploymentStepName =
  | 'request'
  | 'approve'
  | 'provision'
  | 'setup'
  | 'deploy'
  | 'health_check'
  | 'monitor'
  | 'stop'
  | 'terminate'

export interface DeploymentStep {
  name: DeploymentStepName | string
  label: string
  status: DeploymentStepStatus
  order: number
  started_at?: string | null
  completed_at?: string | null
  duration_seconds?: number | null
  output?: string | null
  error?: string | null
}

export interface Deployment {
  id: string
  user_id?: string | null
  netuid: number
  subnet_name?: string | null
  gpu_model_id?: string | null
  gpu_name?: string | null
  provider_id?: string | null
  provider_name?: string | null
  opportunity_score_id?: string | null
  compatibility_test_id?: string | null
  status: DeploymentStatus
  server_id?: string | null
  hotkey_address?: string | null
  deployment_config?: Record<string, unknown> | null
  estimated_monthly_cost?: number | null
  estimated_monthly_revenue?: number | null
  currency?: string | null
  approved_at?: string | null
  provisioned_at?: string | null
  started_at?: string | null
  stopped_at?: string | null
  terminated_at?: string | null
  error_message?: string | null
  extra_metadata?: Record<string, unknown>
  steps?: DeploymentStep[]
  approval_request_id?: string | null
  created_at: string
  updated_at: string
}

export interface DeploymentServer {
  id: string
  deployment_id?: string | null
  provider_id?: string | null
  provider_instance_id?: string | null
  name?: string | null
  region?: string | null
  status?: string | null
  ip_address?: string | null
  ssh_port?: number | null
  gpu_model?: string | null
  gpu_count?: number
  vram_gb?: number | null
  ram_gb?: number | null
  cpu_cores?: number | null
  storage_gb?: number | null
  hourly_cost?: number | null
  currency?: string | null
  provisioned_at?: string | null
  terminated_at?: string | null
  created_at: string
  updated_at: string
}

export interface DeploymentCreateInput {
  netuid: number
  gpu_model_id?: string
  provider_id?: string
  opportunity_score_id?: string
  compatibility_test_id?: string
  hotkey_address?: string
  deployment_config?: Record<string, unknown>
  estimated_monthly_cost?: number
  estimated_monthly_revenue?: number
  currency?: string
}

export interface DeploymentProvisionInput {
  offer: Record<string, unknown>
}

export interface DeploymentTerminateInput {
  reason?: string
  force?: boolean
}

export interface DeploymentActionResult {
  deployment: Deployment
  approval_request_id?: string | null
  approval_required?: boolean
  approval_level?: 'L1' | 'L2' | 'L3' | null
}

export interface ApprovalRequest {
  id: string
  action_type: string
  level: 'L1' | 'L2' | 'L3'
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
  requested_by: string
  approved_by?: string | null
  subject_type?: string | null
  subject_id?: string | null
  reason?: string | null
  risk_score?: number | null
  expires_at?: string | null
  decided_at?: string | null
  decision_note?: string | null
  created_at: string
  updated_at: string
}

export interface ApprovalDecisionInput {
  decision_note?: string
}

export interface DeploymentFilters {
  status?: DeploymentStatus | 'all'
  netuid?: number | null
  search?: string
  page?: number
  page_size?: number
}