'use client'

import { useQuery } from '@tanstack/react-query'
import { api, endpoints } from '@/lib/api'
import type { Subnet, FilterParams } from '@/types'
import type { BackendSubnet, BackendOpportunityDetail } from '@/lib/adapters'

export function useSubnets(params?: FilterParams) {
  return useQuery({
    queryKey: ['subnets', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, String(value))
          }
        })
      }
      return api.getPaginated<BackendSubnet>(
        `${endpoints.subnets}?${searchParams.toString()}`
      )
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useSubnet(id: string | number) {
  return useQuery({
    queryKey: ['subnet', id],
    queryFn: async () => {
      // /subnets/{netuid} returns subnet + latest_metrics in one payload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return api.get<Subnet & { latest_metrics?: any }>(endpoints.subnet(id))
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSubnetMetrics(id: string | number) {
  return useQuery({
    queryKey: ['subnet-metrics', id],
    queryFn: async () => api.get<unknown>(endpoints.subnetMetrics(id)),
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSubnetOpportunity(id: string | number) {
  return useQuery({
    queryKey: ['subnet-opportunity', id],
    queryFn: async () => api.get<BackendOpportunityDetail>(endpoints.subnetOpportunity(id)),
    enabled: !!id,
    staleTime: 1000 * 60 * 2,
  })
}
