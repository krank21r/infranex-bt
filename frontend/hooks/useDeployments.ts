'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { deploymentsApi, approvalsApi } from '@/lib/api'
import type {
  Deployment,
  ApprovalRequest,
  ApprovalDecisionInput,
  DeploymentStatus,
} from '@/types'

export const deploymentKeys = {
  all: ['deployments'] as const,
  list: () => [...deploymentKeys.all, 'list'] as const,
  detail: (id: string) => [...deploymentKeys.all, 'detail', id] as const,
}

export const approvalKeys = {
  all: ['approvals'] as const,
  pending: () => [...approvalKeys.all, 'pending'] as const,
  detail: (id: string) => [...approvalKeys.all, 'detail', id] as const,
}

export function useDeployments() {
  return useQuery({
    queryKey: deploymentKeys.list(),
    queryFn: () => deploymentsApi.listDeployments(),
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  })
}

export function useDeployment(id: string | undefined) {
  return useQuery({
    queryKey: deploymentKeys.detail(id ?? ''),
    queryFn: () => deploymentsApi.getDeployment(id as string),
    enabled: !!id,
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 15,
  })
}

export function useCreateDeployment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deploymentsApi.createDeployment,
    onSuccess: (deployment) => {
      qc.setQueryData<Deployment[]>(deploymentKeys.list(), (prev) =>
        prev ? [deployment, ...prev] : [deployment]
      )
      qc.invalidateQueries({ queryKey: deploymentKeys.all })
    },
  })
}

export function useApproveDeployment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (levels: ('L1' | 'L2' | 'L3')[]) => deploymentsApi.approveDeployment(id, levels),
    onSuccess: (deployment) => {
      qc.setQueryData(deploymentKeys.detail(id), deployment)
      qc.invalidateQueries({ queryKey: deploymentKeys.list() })
    },
  })
}

export function useProvisionDeployment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (offer: Record<string, unknown>) => deploymentsApi.provisionDeployment(id, offer),
    onSuccess: (deployment) => {
      qc.setQueryData(deploymentKeys.detail(id), deployment)
      qc.invalidateQueries({ queryKey: deploymentKeys.list() })
    },
  })
}

export function useDeployMiner(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => deploymentsApi.deployMiner(id),
    onSuccess: (deployment) => {
      qc.setQueryData(deploymentKeys.detail(id), deployment)
      qc.invalidateQueries({ queryKey: deploymentKeys.list() })
    },
  })
}

export function useTerminateDeployment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (reason?: string) => deploymentsApi.terminateDeployment(id, reason),
    onSuccess: (deployment) => {
      qc.setQueryData(deploymentKeys.detail(id), deployment)
      qc.invalidateQueries({ queryKey: deploymentKeys.list() })
    },
  })
}

export function useTickDeployment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => deploymentsApi.tickDeployment(id),
    onSuccess: (deployment) => {
      qc.setQueryData(deploymentKeys.detail(id), deployment)
    },
  })
}

export function usePendingApprovals() {
  return useQuery({
    queryKey: approvalKeys.pending(),
    queryFn: () => approvalsApi.listPending(),
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 30,
  })
}

export function useApproval(id: string | undefined) {
  return useQuery({
    queryKey: approvalKeys.detail(id ?? ''),
    queryFn: () => approvalsApi.getApproval(id as string),
    enabled: !!id,
    staleTime: 1000 * 15,
  })
}

export function useDecideApproval(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ approve, body }: { approve: boolean; body?: ApprovalDecisionInput }) =>
      approve ? approvalsApi.approve(id, body ?? {}) : approvalsApi.reject(id, body ?? {}),
    onSuccess: (approval: ApprovalRequest) => {
      qc.setQueryData(approvalKeys.detail(id), approval)
      qc.invalidateQueries({ queryKey: approvalKeys.pending() })
      if (approval.subject_id) {
        qc.invalidateQueries({ queryKey: deploymentKeys.detail(approval.subject_id) })
        qc.invalidateQueries({ queryKey: deploymentKeys.list() })
      }
    },
  })
}

export function useCancelApproval(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => approvalsApi.cancel(id),
    onSuccess: (approval) => {
      qc.setQueryData(approvalKeys.detail(id), approval)
      qc.invalidateQueries({ queryKey: approvalKeys.pending() })
    },
  })
}

export function isTerminalStatus(status: DeploymentStatus | string): boolean {
  return ['terminated', 'failed', 'stopped'].includes(status)
}