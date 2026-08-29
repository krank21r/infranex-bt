'use client'

import { useQuery } from '@tanstack/react-query'
import { api, endpoints } from '@/lib/api'

export interface SubnetChange {
  id: string
  netuid: number
  change_type: string
  old_value: { value: unknown } | null
  new_value: { value: unknown } | null
  impact: 'none' | 'low' | 'medium' | 'high' | 'critical'
  affected_miners: string[]
  detected_at: string
  source: string
  notes: string | null
}

export interface WorkerMetrics {
  worker_name: string
  is_running: boolean
  is_healthy: boolean
  runs_total: number
  runs_success: number
  runs_failed: number
  success_rate: number
  avg_duration_ms: number
  last_run_at: number | null
  last_error: string | null
}

export function useSubnetChanges(netuid: number) {
  return useQuery({
    queryKey: ['subnet-changes', netuid],
    queryFn: async () => {
      const data = await api.get<SubnetChange[]>(endpoints.subnetChanges(netuid))
      return data
    },
    enabled: !!netuid,
    staleTime: 1000 * 60 * 2,
  })
}

export function useWorkerStatus() {
  return useQuery({
    queryKey: ['worker-status'],
    queryFn: async () => {
      const data = await api.get<{ workers: WorkerMetrics[] }>(endpoints.workersStatus)
      return data?.workers ?? []
    },
    staleTime: 1000 * 60,
    refetchInterval: 30000,
  })
}
