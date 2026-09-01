'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { minerApi } from '@/lib/api'
import type {
  UserMiner,
  HotkeyValidationResult,
  MinerRegistration,
} from '@/types'

export const userMinerKeys = {
  all: ['user-miners'] as const,
  list: () => [...userMinerKeys.all, 'list'] as const,
  detail: (id: string) => [...userMinerKeys.all, 'detail', id] as const,
}

export function useUserMiners() {
  return useQuery({
    queryKey: userMinerKeys.list(),
    queryFn: () => minerApi.getUserMiners(),
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 60,
  })
}

export function useUserMiner(id: string | undefined) {
  return useQuery({
    queryKey: userMinerKeys.detail(id ?? ''),
    queryFn: () => minerApi.getUserMiners().then((items) => items.find((m) => m.id === id)),
    enabled: !!id,
    staleTime: 1000 * 30,
  })
}

export function useRegisterMiner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: MinerRegistration) => minerApi.registerMiner(data),
    onSuccess: (miner) => {
      queryClient.setQueryData<UserMiner[]>(userMinerKeys.list(), (prev) =>
        prev ? [miner, ...prev] : [miner]
      )
      queryClient.invalidateQueries({ queryKey: userMinerKeys.all })
    },
  })
}

export function useUpdateMiner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MinerRegistration> & { status?: string } }) =>
      minerApi.updateMiner(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData<UserMiner[]>(userMinerKeys.list(), (prev) =>
        prev ? prev.map((m) => (m.id === updated.id ? updated : m)) : [updated]
      )
      queryClient.invalidateQueries({ queryKey: userMinerKeys.detail(updated.id) })
    },
  })
}

export function useDeleteMiner() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => minerApi.deleteMiner(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<UserMiner[]>(userMinerKeys.list(), (prev) =>
        prev ? prev.filter((m) => m.id !== id) : prev
      )
      queryClient.invalidateQueries({ queryKey: userMinerKeys.all })
    },
  })
}

export function useValidateHotkey() {
  return useMutation<HotkeyValidationResult, Error, { hotkey: string; netuid: number }>({
    mutationFn: ({ hotkey, netuid }) => minerApi.validateHotkey(hotkey, netuid),
  })
}