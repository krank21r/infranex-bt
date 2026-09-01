'use client'

import { useQuery } from '@tanstack/react-query'
import { api, endpoints } from '@/lib/api'
import type { Subnet, FilterParams } from '@/types'
import type { BackendSubnet, BackendOpportunityDetail } from '@/lib/adapters'
import { fetchSubnetsRaw, getSupabaseDataClient } from '@/lib/supabase-data'
import type { BackendSubnetMetrics } from '@/lib/adapters'

interface SubnetListResponse {
  data: BackendSubnet[]
  total: number
  page: number
  limit: number
  totalPages: number
}

function buildQueryString(params?: FilterParams): string {
  const sp = new URLSearchParams()
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        sp.append(key, String(value))
      }
    })
  }
  return sp.toString()
}

export function useSubnets(params?: FilterParams) {
  return useQuery({
    queryKey: ['subnets', params],
    queryFn: async (): Promise<SubnetListResponse> => {
      const sb = getSupabaseDataClient()
      if (sb) {
        try {
          const items = await fetchSubnetsRaw({
            limit: params?.page_size ?? 100,
          })
          if (items.length > 0) {
            return {
              data: items,
              total: items.length,
              page: params?.page ?? 1,
              limit: params?.page_size ?? items.length,
              totalPages: 1,
            }
          }
        } catch {
          // fall through to backend
        }
      }
      return api.getPaginated<BackendSubnet>(
        `${endpoints.subnets}?${buildQueryString(params)}`
      )
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useSubnet(id: string | number) {
  return useQuery({
    queryKey: ['subnet', id],
    queryFn: async () => {
      return api.get<Subnet & { latest_metrics?: BackendSubnetMetrics | null }>(
        endpoints.subnet(id)
      )
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSubnetMetrics(id: string | number) {
  return useQuery({
    queryKey: ['subnet-metrics', id],
    queryFn: async () => api.get<BackendSubnetMetrics>(endpoints.subnetMetrics(id)),
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSubnetOpportunity(id: string | number) {
  return useQuery({
    queryKey: ['subnet-opportunity', id],
    queryFn: async () =>
      api.get<BackendOpportunityDetail>(endpoints.subnetOpportunity(id)),
    enabled: !!id,
    staleTime: 1000 * 60 * 2,
  })
}