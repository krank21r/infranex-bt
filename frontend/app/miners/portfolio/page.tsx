'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Plus, RefreshCw, Coins, AlertTriangle, Power } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { MinerCard, MinerCardSkeleton } from '@/components/miners/MinerCard'
import type { MinerAction } from '@/components/miners/MinerCard'
import {
  useUserMiners,
  useDeleteMiner,
  useUpdateMiner,
} from '@/hooks/useUserMiners'
import { formatTao } from '@/lib/utils'
import type { UserMiner } from '@/types'

export default function PortfolioPage() {
  const router = useRouter()
  const { data: miners, isLoading, refetch, isRefetching } = useUserMiners()
  const deleteMiner = useDeleteMiner()
  const updateMiner = useUpdateMiner()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | UserMiner['status']>('all')

  const items = useMemo(() => miners ?? [], [miners])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false
      if (!term) return true
      return (
        m.name.toLowerCase().includes(term) ||
        m.hotkey.toLowerCase().includes(term) ||
        m.subnet_name?.toLowerCase().includes(term) ||
        String(m.netuid).includes(term)
      )
    })
  }, [items, search, statusFilter])

  const totalEarnings = items.reduce((acc, m) => acc + (m.total_earnings ?? 0), 0)
  const activeCount = items.filter((m) => m.status === 'active').length
  const inactiveCount = items.filter((m) =>
    ['inactive', 'stopped', 'deregistered'].includes(m.status)
  ).length

  const handleAction = async (action: MinerAction, miner: UserMiner) => {
    setBusyId(miner.id)
    try {
      if (action === 'view') {
        router.push(`/miners/${miner.id}`)
        return
      }
      if (action === 'start') {
        await updateMiner.mutateAsync({ id: miner.id, data: { status: 'active' } })
      } else if (action === 'stop') {
        await updateMiner.mutateAsync({ id: miner.id, data: { status: 'inactive' } })
      } else if (action === 'delete') {
        if (typeof window !== 'undefined' && !window.confirm(`Remove "${miner.name}"?`)) return
        await deleteMiner.mutateAsync(miner.id)
      } else if (action === 'migrate') {
        router.push(`/miners/${miner.id}?migrate=1`)
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
            <h1 className="text-3xl font-bold tracking-tight">Miner Portfolio</h1>
            <p className="text-muted-foreground">
              Manage your registered Bittensor miners
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button asChild>
              <Link href="/miners/register">
                <Plus className="h-4 w-4 mr-2" />
                Register Miner
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-2">
              <Coins className="h-4 w-4 text-success" />
              <div>
                <p className="text-xs text-muted-foreground">Total Earnings</p>
                <p className="text-xl font-bold">{formatTao(totalEarnings)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-2">
              <Power className="h-4 w-4 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Active</p>
                <p className="text-xl font-bold">{activeCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Inactive</p>
                <p className="text-xl font-bold">{inactiveCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, hotkey, subnet…"
            className="sm:max-w-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {(['all', 'active', 'inactive', 'pending', 'error'] as const).map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? 'All' : s}
              </Button>
            ))}
          </div>
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
                  <p className="text-sm font-medium">No miners registered yet</p>
                  <p className="text-xs">Register your first miner to start tracking it.</p>
                  <Button asChild className="mt-2">
                    <Link href="/miners/register">
                      <Plus className="h-4 w-4 mr-2" />
                      Register Miner
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">No miners match your filters</p>
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
            {filtered.map((miner) => (
              <MinerCard
                key={miner.id}
                miner={miner}
                busy={busyId === miner.id}
                onAction={handleAction}
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