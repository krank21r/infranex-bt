'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, RefreshCw, Coins } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { MinerCard, MinerCardSkeleton } from '@/components/miners/MinerCard'
import {
  useDeployments,
} from '@/hooks/useDeployments'
import type { Deployment, UserMiner, DeploymentStatus } from '@/types'
import { deploymentsApi } from '@/lib/api'

export default function DeploymentsPage() {
  const router = useRouter()
  const { data: deployments, isLoading, refetch } = useDeployments()

  const [search, setSearch] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [statusFilter, setStatusFilter] = useState<DeploymentStatus | 'all'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const items = useMemo(() => deployments ?? [], [deployments])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((d) => {
      if (!term) return true
      return (
        (d.subnet_name || '').toLowerCase().includes(term) ||
        String(d.netuid).includes(term) ||
        String(d.id).includes(term)
      )
    })
  }, [items, search])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    items.forEach((d) => {
      const s = d.status
      counts[s] = (counts[s] || 0) + 1
    })
    return counts
  }, [items])

  const handleAction = async (action: string, deployment: Deployment) => {
    setBusyId(deployment.id)
    try {
      if (action === 'view') {
        router.push(`/deployments/${deployment.id}`)
        return
      }
      if (action === 'approve') {
        await deploymentsApi.approveDeployment(deployment.id, ['L1'])
      } else if (action === 'provision') {
        await deploymentsApi.provisionDeployment(deployment.id, { offer: {} })
      } else if (action === 'deploy') {
        await deploymentsApi.deployMiner(deployment.id)
      } else if (action === 'terminate') {
        await deploymentsApi.terminateDeployment(deployment.id, 'User requested termination')
      } else if (action === 'tick') {
        await deploymentsApi.tickDeployment(deployment.id)
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Deployments</h1>
            <p className="text-muted-foreground">
              Manage your Bittensor miner deployments
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button asChild>
            <Link href="/deployments/register">
              <Plus className="h-4 w-4 mr-2" />
              Request New Deployment
            </Link>
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {['requested', 'approved', 'provisioning', 'provisioned', 'ready', 'deploying', 'started', 'stopped', 'terminated', 'failed'].map((s) => {
            const count = statusCounts[s] || 0
            const ColorClass = s === 'requested' ? 'bg-primary/10 text-primary' : s === 'approved' ? 'bg-success/10 text-success' : s === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-muted-foreground'
            return (
              <Card key={s} className="p-4">
                <CardContent className="flex items-center gap-2">
                  <span className={ColorClass} />
                  <span className="font-medium">{s}</span>
                  <span className="text-xs ml-2">{count}</span>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <MinerCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground space-y-3">
              {items.length === 0 ? (
                <>
                  <Coins className="h-10 w-10 mx-auto opacity-40" />
                  <p className="text-sm font-medium">No deployments yet</p>
                  <p className="text-xs mt-1">
                    Request your first deployment to see it here.
                  </p>
                  <Button asChild className="mt-2">
                    <Link href="/deployments/register">
                      <Plus className="h-4 w-4 mr-2" />
                      Request Deployment
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">No deployments match your filters</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('all')
                    }}
                  >
                    Clear filters
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((deployment) => (
              <MinerCard
                key={deployment.id}
                miner={deployment as unknown as UserMiner}
                busy={busyId === deployment.id}
                onAction={(action) => handleAction(action, deployment)}
              />
            ))}
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <Skeleton className="h-0" aria-hidden="true" />
        )}
      </div>
    </DashboardLayout>
  )
}