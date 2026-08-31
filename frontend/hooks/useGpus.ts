'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, endpoints } from '@/lib/api'
import type {
  GPUModel,
  GPUProvider,
  GPUOffer,
  GPURequirementInput,
  GPURecommendation,
  GpuCatalogParams,
} from '@/types'

export function useGpuModels(params?: GpuCatalogParams) {
  return useQuery({
    queryKey: ['gpu-models', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, String(value))
          }
        })
      }
      return api.getPaginated<GPUModel>(
        `${endpoints.gpus}?${searchParams.toString()}`
      )
    },
    staleTime: 1000 * 60 * 10,
  })
}

export function useGpuProviders() {
  return useQuery({
    queryKey: ['gpu-providers'],
    queryFn: async () => api.get<GPUProvider[]>(endpoints.gpuProviders),
    staleTime: 1000 * 60 * 10,
  })
}

export function useGpuOffers(params?: GpuCatalogParams) {
  return useQuery({
    queryKey: ['gpu-offers', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams()
      if (params) {
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            searchParams.append(key, String(value))
          }
        })
      }
      return api.getPaginated<GPUOffer>(
        `${endpoints.gpuOffers}?${searchParams.toString()}`
      )
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useGpuRecommendation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      netuid?: number | null
      requirements?: GPURequirementInput | null
      preferred_region?: string | null
    }) => {
      const body: Record<string, unknown> = {
        netuid: input.netuid ?? null,
        requirements: input.requirements ?? null,
        preferred_region: input.preferred_region ?? null,
        page: 1,
        page_size: 25,
      }
      return api.post<GPURecommendation>(endpoints.gpuRecommend, body)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gpu-recommendation'] })
    },
  })
}
