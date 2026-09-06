import { createBrowserClient } from '@supabase/ssr'
import type {
  UserMiner,
  HotkeyValidationResult,
  Deployment,
  DeploymentStep,
  ApprovalRequest,
  ApprovalDecisionInput,
} from '@/types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api'

/** Standard backend envelope: { success, data, message?, meta? } */
interface APIEnvelope<T> {
  success: boolean
  data: T
  message?: string
  meta?: {
    page?: number
    page_size?: number
    total_items?: number
    total_pages?: number
    has_next?: boolean
    has_prev?: boolean
  }
}

interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}

class ApiClient {
  private supabase: ReturnType<typeof createBrowserClient> | null = null

  private getSupabase() {
    if (!this.supabase) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!url || !key) {
        return null
      }
      this.supabase = createBrowserClient(url, key)
    }
    return this.supabase
  }

  private async getHeaders(): Promise<HeadersInit> {
    const supabase = this.getSupabase()
    const session = supabase ? (await supabase.auth.getSession()).data.session : null

    return {
      'Content-Type': 'application/json',
      ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
    }
  }

  /** Core request — returns the raw envelope. */
  private async requestRaw<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<APIEnvelope<T>> {
    const headers = await this.getHeaders()

    // 20s upper bound matches the worst observed Vercel Python cold-start on
    // /api/monitoring/overview. Without this, a hung cold-start request never
    // resolves and React Query sits in `isLoading` until the user navigates
    // away. The retry policy in app/providers.tsx picks up from there.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
          ...headers,
          ...options.headers,
        },
        signal: options.signal ?? controller.signal,
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }))
        throw new Error(error.message || `HTTP error! status: ${response.status}`)
      }

      if (response.status === 204) {
        return { success: true, data: {} as T }
      }

      return response.json()
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Request that returns the inner data directly. */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const envelope = await this.requestRaw<APIEnvelope<T>['data']>(endpoint, options)
    return envelope.data
  }

  /** Request that returns a normalized paginated response. */
  async requestPaginated<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<PaginatedResponse<T>> {
    const envelope = await this.requestRaw<{ items: T[] } | T[]>(endpoint, options)
    const data: unknown = envelope.data
    let items: T[] = []
    if (Array.isArray(data)) {
      items = data
    } else if (data !== null && typeof data === 'object' && 'items' in data) {
      const maybeItems = (data as Record<string, unknown>).items
      if (Array.isArray(maybeItems)) {
        items = maybeItems as T[]
      }
    }
    const m = envelope.meta ?? {}
    const page = m.page ?? 1
    const limit = m.page_size ?? items.length
    const total = m.total_items ?? items.length
    return {
      data: items,
      total,
      page,
      limit,
      totalPages: m.total_pages ?? (total && limit ? Math.ceil(total / limit) : 0),
    }
  }

  get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' })
  }

  getPaginated<T>(endpoint: string): Promise<PaginatedResponse<T>> {
    return this.requestPaginated<T>(endpoint, { method: 'GET' })
  }

  post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'POST', body: JSON.stringify(body) })
  }

  put<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PUT', body: JSON.stringify(body) })
  }

  patch<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: 'PATCH', body: JSON.stringify(body) })
  }

  delete<T = void>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' })
  }
}

export const api = new ApiClient()

/** API endpoints */
export const endpoints = {
  subnets: '/subnets',
  subnet: (id: string | number) => `/subnets/${id}`,
  subnetMetrics: (id: string | number) => `/subnets/${id}/metrics`,
  subnetOpportunity: (id: string | number) => `/subnets/${id}/opportunity`,

  opportunities: '/opportunities',
  opportunity: (id: string | number) => `/opportunities/${id}`,
  topOpportunities: (limit = 10) => `/opportunities/top/${limit}`,
  recalculateOpportunity: (id: string | number) => `/opportunities/${id}/recalculate`,

  gpus: '/gpus',
  gpuProviders: '/gpus/providers',
  gpuOffers: '/gpus/offers',
  cheapestOffer: '/gpus/offers/cheapest',
  gpuRecommend: '/gpus/recommend',

  providers: '/providers',
  provider: (id: string) => `/providers/${id}`,
  providerOffers: (id: string) => `/providers/${id}/offers`,

  health: '/health',
  healthLive: '/health/live',
  healthReady: '/health/ready',
  healthDetails: '/health/details',

  authVerify: '/auth/verify',
  authLogout: '/auth/logout',

  monitoringOverview: '/monitoring/overview',
  monitoringMiner: (id: string) => `/monitoring/miners/${id}`,
  monitoringAlerts: '/monitoring/alerts',
  monitoringResolveAlert: (id: string) => `/monitoring/alerts/${id}/resolve`,
  monitoringEvents: '/monitoring/events',

  // Change detection
  subnetChanges: (netuid: number) => `/v2/opportunities/${netuid}/history`,

  // Worker status
  orchestratorStatus: '/orchestrator/status',
  workersStatus: '/orchestrator/status',

  // User miners
  myMiners: '/miners/my',
  registerMiner: '/miners/register',
  userMiner: (id: string) => `/miners/my/${id}`,
  validateHotkey: '/miners/validate-hotkey',

  // Deployments
  deployments: '/deployments',
  deployment: (id: string) => `/deployments/${id}`,
  deploymentPreview: '/deployments/preview',
  deploymentApprove: (id: string) => `/deployments/${id}/approve`,
  deploymentProvision: (id: string) => `/deployments/${id}/provision`,
  deploymentDeploy: (id: string) => `/deployments/${id}/deploy`,
  deploymentTerminate: (id: string) => `/deployments/${id}/terminate`,
  deploymentTick: (id: string) => `/deployments/${id}/tick`,

  // Approvals
  approvalsPending: '/approvals/pending',
  approvalsAudit: '/approvals/audit',
  approval: (id: string) => `/approvals/${id}`,
  approvalApprove: (id: string) => `/approvals/${id}/approve`,
  approvalReject: (id: string) => `/approvals/${id}/reject`,
  approvalCancel: (id: string) => `/approvals/${id}/cancel`,
}

export type MinerRegistrationPayload = {
  name: string
  hotkey: string
  netuid: number
  description?: string
  tags?: string[]
}

export type MinerUpdatePayload = Partial<{
  name: string
  description: string
  tags: string[]
  status: string
}>

export type PreviewDeploymentRequest = {
  netuid: number
  gpu_model_id?: string
  provider_id?: string
  hotkey_address?: string
  opportunity_score_id?: string
  compatibility_test_id?: string
  deployment_config?: Record<string, unknown>
  estimated_monthly_cost?: number
  estimated_monthly_revenue?: number
  currency?: string
}

export type DeploymentDetail = Deployment & {
  current_state?: string
  progress?: number
  gpu_model?: string
  vram_gb?: number
  uid?: number
  incentive?: number
  trust?: number
  consensus?: number
  earnings_tao?: number
  earnings_usd?: number
  uptime_seconds?: number
}

export interface DeploymentPreviewResult {
  estimated_cost: number
  estimated_revenue: number
  compatibility: Record<string, unknown>
}

export type ApprovalLevel = 'L1' | 'L2' | 'L3'

export const minerApi = {
  getUserMiners(): Promise<UserMiner[]> {
    return api.get<UserMiner[]>(endpoints.myMiners)
  },
  registerMiner(data: MinerRegistrationPayload): Promise<UserMiner> {
    return api.post<UserMiner>(endpoints.registerMiner, data)
  },
  updateMiner(id: string, data: MinerUpdatePayload): Promise<UserMiner> {
    return api.patch<UserMiner>(endpoints.userMiner(id), data)
  },
  deleteMiner(id: string): Promise<void> {
    return api.delete<void>(endpoints.userMiner(id))
  },
  validateHotkey(hotkey: string, netuid: number): Promise<HotkeyValidationResult> {
    return api.post<HotkeyValidationResult>(endpoints.validateHotkey, { hotkey, netuid })
  },
}

export const deploymentsApi = {
  listDeployments(): Promise<Deployment[]> {
    return api.get<Deployment[]>(endpoints.deployments)
  },
  getDeployment(id: string): Promise<DeploymentDetail> {
    return api.get<DeploymentDetail>(endpoints.deployment(id))
  },
  previewDeployment(req: PreviewDeploymentRequest): Promise<DeploymentPreviewResult> {
    return api.post<DeploymentPreviewResult>(endpoints.deploymentPreview, req)
  },
  createDeployment(req: PreviewDeploymentRequest): Promise<Deployment> {
    return api.post<Deployment>(endpoints.deployments, req)
  },
  approveDeployment(id: string, levels: ApprovalLevel[]): Promise<Deployment> {
    return api.post<Deployment>(endpoints.deploymentApprove(id), { levels })
  },
  provisionDeployment(id: string, offer: Record<string, unknown>): Promise<Deployment> {
    return api.post<Deployment>(endpoints.deploymentProvision(id), { offer })
  },
  deployMiner(id: string): Promise<Deployment> {
    return api.post<Deployment>(endpoints.deploymentDeploy(id), {})
  },
  terminateDeployment(id: string, reason?: string): Promise<Deployment> {
    return api.post<Deployment>(endpoints.deploymentTerminate(id), { reason })
  },
  tickDeployment(id: string): Promise<Deployment> {
    return api.post<Deployment>(endpoints.deploymentTick(id), {})
  },
}

export const approvalsApi = {
  listPending(): Promise<ApprovalRequest[]> {
    return api.get<ApprovalRequest[]>(endpoints.approvalsPending)
  },
  getApproval(id: string): Promise<ApprovalRequest> {
    return api.get<ApprovalRequest>(endpoints.approval(id))
  },
  approve(id: string, body: ApprovalDecisionInput = {}): Promise<ApprovalRequest> {
    return api.post<ApprovalRequest>(endpoints.approvalApprove(id), body)
  },
  reject(id: string, body: ApprovalDecisionInput = {}): Promise<ApprovalRequest> {
    return api.post<ApprovalRequest>(endpoints.approvalReject(id), body)
  },
  cancel(id: string): Promise<ApprovalRequest> {
    return api.post<ApprovalRequest>(endpoints.approvalCancel(id), {})
  },
}

export type { Deployment, DeploymentStep }
