'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, endpoints } from '@/lib/api'
import type { MonitoringOverview, MinerHealthSummary, Alert } from '@/types'

export function useMonitoringOverview() {
  return useQuery({
    queryKey: ['monitoring', 'overview'],
    queryFn: async () => api.get<MonitoringOverview>(endpoints.monitoringOverview),
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  })
}

export function useMinerHealth(minerId: string) {
  return useQuery({
    queryKey: ['monitoring', 'miner', minerId],
    queryFn: async () => api.get<MinerHealthSummary>(endpoints.monitoringMiner(minerId)),
    enabled: !!minerId,
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 15,
  })
}

export function useActiveAlerts() {
  return useQuery({
    queryKey: ['monitoring', 'alerts'],
    queryFn: async () => api.get<Alert[]>(endpoints.monitoringAlerts),
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 15,
  })
}

export function useResolveAlert() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (alertId: string) =>
      api.post<Alert>(endpoints.monitoringResolveAlert(alertId), {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitoring'] })
    },
  })
}

export function useMonitoringEvents(onEvent: (event: unknown) => void) {
  if (typeof window === 'undefined') return null

  const eventSource = new EventSource(endpoints.monitoringEvents)

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      onEvent(data)
    } catch {
      // ignore malformed events
    }
  }

  eventSource.onerror = () => {
    eventSource.close()
  }

  return eventSource
}
