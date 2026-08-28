'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, endpoints } from '@/lib/api'
import type { Opportunity, FilterParams } from '@/types'

export function useOpportunities(params?: FilterParams) {
  return useQuery({
    queryKey: ['opportunities', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, String(value))
          }
        })
      }
      return api.getPaginated<Opportunity>(
        `${endpoints.opportunities}?${searchParams.toString()}`
      )
    },
    staleTime: 1000 * 60 * 2,
    refetchInterval: 1000 * 60 * 5,
  })
}

export function useOpportunity(id: string | number) {
  return useQuery({
    queryKey: ['opportunity', id],
    queryFn: async () => {
      // /opportunities/{netuid} returns the live computed score, not a DB row
      return api.get<Opportunity>(endpoints.opportunity(id))
    },
    enabled: !!id,
    staleTime: 1000 * 60 * 2,
  })
}

export function useTopOpportunities(limit = 10) {
  return useQuery({
    queryKey: ['opportunities', 'top', limit],
    queryFn: async () => {
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
