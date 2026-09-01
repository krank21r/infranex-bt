'use client'

import Link from 'next/link'
import { Coins, Play, Power, ArrowRightLeft, ExternalLink, Trash2, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatTao, formatRelativeTime, getStatusColor } from '@/lib/utils'
import { formatHotkey } from '@/lib/wallet'
import { copyToClipboard } from '@/lib/wallet'
import type { UserMiner } from '@/types'

export type MinerAction = 'view' | 'start' | 'stop' | 'migrate' | 'delete'

interface MinerCardProps {
  miner: UserMiner
  onAction?: (action: MinerAction, miner: UserMiner) => void
  busy?: boolean
  className?: string
}

function StatusBadge({ status }: { status: UserMiner['status'] }) {
  const colors = getStatusColor(status)
  return (
    <Badge variant="outline" className={cn('border-0', colors.bg, colors.text)}>
      <span className={cn('h-1.5 w-1.5 rounded-full mr-1.5', colors.dot)} />
      {status}
    </Badge>
  )
}

function MinerCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-64" />
        <div className="grid grid-cols-3 gap-3 pt-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-9" />
        </div>
      </CardContent>
    </Card>
  )
}

export function MinerCard({ miner, onAction, busy, className }: MinerCardProps) {
  const handleCopy = async () => {
    await copyToClipboard(miner.hotkey)
  }

  return (
    <Card className={cn('transition-colors hover:border-primary/40', className)}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-primary shrink-0" />
              <h3 className="text-base font-semibold truncate">{miner.name}</h3>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="font-mono text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Click to copy"
            >
              {formatHotkey(miner.hotkey, 10, 10)}
            </button>
          </div>
          <StatusBadge status={miner.status} />
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2 border-t">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Subnet</p>
            <p className="text-sm font-medium truncate">
              {miner.subnet_name || `Subnet ${miner.netuid}`}
            </p>
            <p className="text-[10px] text-muted-foreground">netuid {miner.netuid}</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Earnings</p>
            <p className="text-sm font-medium">{formatTao(miner.total_earnings ?? 0)}</p>
            <p className="text-[10px] text-muted-foreground">total</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Uptime</p>
            <p className="text-sm font-medium">
              {(miner.uptime_percent ?? 0).toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" />
              {formatRelativeTime(miner.created_at)}
            </p>
          </div>
        </div>

        {miner.tags && miner.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {miner.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] font-normal">
                {tag}
              </Badge>
            ))}
            {miner.tags.length > 4 && (
              <Badge variant="secondary" className="text-[10px] font-normal">
                +{miner.tags.length - 4}
              </Badge>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-1.5 pt-2 border-t">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/miners/${miner.id}`}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              View
            </Link>
          </Button>
          {miner.status === 'inactive' || miner.status === 'stopped' ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => onAction?.('start', miner)}
              disabled={busy}
              title="Start"
              aria-label="Start miner"
            >
              <Play className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon"
              onClick={() => onAction?.('stop', miner)}
              disabled={busy}
              title="Stop"
              aria-label="Stop miner"
            >
              <Power className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={() => onAction?.('migrate', miner)}
            disabled={busy}
            title="Migrate"
            aria-label="Migrate miner"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => onAction?.('delete', miner)}
            disabled={busy}
            title="Remove"
            aria-label="Remove miner"
            className="hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export { MinerCardSkeleton }