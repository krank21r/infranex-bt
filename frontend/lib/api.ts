import { createBrowserClient } from '@supabase/ssr'

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

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }))
      throw new Error(error.message || `HTTP error! status: ${response.status}`)
    }

    if (response.status === 204) {
      return { success: true, data: {} as T }
    }

    return response.json()
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
}
