'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, endpoints } from '@/lib/api'
import type { Opportunity, FilterParams, PaginatedResponse } from '@/types'
import { fetchOpportunities, getSupabaseDataClient } from '@/lib/supabase-data'

interface OpportunityListParams extends FilterParams {
  min_score?: number
  sort_by?: string
  sort_order?: 'asc' | 'desc'
}

function buildUrl(params?: OpportunityListParams): string {
  const sp = new URLSearchParams()
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        sp.append(key, String(value))
      }
    })
  }
  return `${endpoints.opportunities}?${sp.toString()}`
}

function buildFallbackPage(
  items: Opportunity[],
  page = 1,
  pageSize = 50
): PaginatedResponse<Opportunity> {
  return {
    data: items,
    total: items.length,
    page,
    limit: pageSize,
    totalPages: 1,
  }
}

export function useOpportunities(params?: OpportunityListParams) {
  return useQuery({
    queryKey: ['opportunities', params],
    queryFn: async (): Promise<PaginatedResponse<Opportunity>> => {
      const sb = getSupabaseDataClient()
      if (sb) {
        try {
          const items = await fetchOpportunities({
            minScore: params?.min_score,
            limit: params?.page_size ?? 50,
          })
          return buildFallbackPage(items, params?.page ?? 1, params?.page_size ?? 50)
        } catch (err) {
          // Surface the actual Supabase error so the UI shows it instead of
          // a generic backend error from the fallback /api call.
          throw new Error(
            `Supabase direct query failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        }
      }
      return api.getPaginated<Opportunity>(buildUrl(params))
    },
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 5,
  })
}

export function useOpportunity(id: string | number) {
  return useQuery({
    queryKey: ['opportunity', id],
    queryFn: async () => api.get<Opportunity>(endpoints.opportunity(id)),
    enabled: !!id,
    staleTime: 1000 * 60 * 2,
  })
}

export function useTopOpportunities(limit = 10) {
  return useQuery({
    queryKey: ['opportunities', 'top', limit],
    queryFn: async (): Promise<Opportunity[]> => {
      const sb = getSupabaseDataClient()
      if (sb) {
        try {
          const items = await fetchOpportunities({ limit })
          if (items.length > 0) return items
        } catch {
          // fall through
        }
      }
      const data = await api.get<Opportunity[]>(endpoints.topOpportunities(limit))
      return Array.isArray(data) ? data : []
    },
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 5,
  })
}

export function useRecalculateOpportunity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (netuid: number) =>
      api.post<Opportunity>(endpoints.recalculateOpportunity(netuid), {}),
    onSuccess: (_, netuid) => {
      queryClient.invalidateQueries({ queryKey: ['opportunities'] })
      queryClient.invalidateQueries({ queryKey: ['opportunity', netuid] })
    },
  })
}