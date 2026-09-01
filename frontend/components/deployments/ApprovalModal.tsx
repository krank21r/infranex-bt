'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useApproval } from '@/hooks/useDeployments'
import type { ApprovalRequest } from '@/types'

export function PendingApprovalsModal({
  approvalIds,
  onSelect,
  onClose,
}: {
  approvalIds: string[]
  onSelect: (approvalId: string) => void
  onClose: () => void
}) {
  // Call useApproval exactly 3 times on every render (max approvals)
  // This satisfies React's rules of hooks - same order each render
  const approval1 = useApproval(approvalIds[0] || '').data
  const approval2 = useApproval(approvalIds[1] || '').data
  const approval3 = useApproval(approvalIds[2] || '').data

  return (
    <Dialog open={approvalIds.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/80" />
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approval Required</DialogTitle>
            {approvalIds.length > 1 && (
              <DialogDescription>
                {approvalIds.length} pending approval{'s'}
              </DialogDescription>
            )}
          </DialogHeader>

          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" /> Cancel
            </Button>
          </DialogFooter>

          {approvalIds.length === 0 ? (
            <DialogContent className="p-6">
              <p className="text-muted-foreground text-sm">No pending approvals found.</p>
            </DialogContent>
          ) : approvalIds.length === 1 ? (
            <ApprovalCard
              key={approvalIds[0]}
              approval={approval1!}
              onApprove={approval1?.status === 'pending' ? () => onSelect(approval1.id) : undefined}
              onReject={approval1?.status === 'pending' ? () => onSelect(approval1.id) : undefined}
              onCancel={onClose}
            />
          ) : (
            <div className="space-y-4">
              {approval1 && (
                <ApprovalCard
                  key={approvalIds[0]}
                  approval={approval1}
                  onApprove={() => onSelect(approval1.id)}
                  onReject={() => onSelect(approval1.id)}
                  onCancel={onClose}
                />
              )}
              {approval2 && (
                <ApprovalCard
                  key={approvalIds[1]}
                  approval={approval2}
                  onApprove={() => onSelect(approval2.id)}
                  onReject={() => onSelect(approval2.id)}
                  onCancel={onClose}
                />
              )}
              {approval3 && (
                <ApprovalCard
                  key={approvalIds[2]}
                  approval={approval3}
                  onApprove={() => onSelect(approval3.id)}
                  onReject={() => onSelect(approval3.id)}
                  onCancel={onClose}
                />
              )}
            </div>
          )}
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}

function ApprovalCard({
  approval,
  onApprove,
  onReject,
  onCancel,
}: {
  approval: ApprovalRequest
  onApprove?: () => void
  onReject?: () => void
  onCancel?: () => void
}) {
  const isPending = approval.status === 'pending'

  return (
    <div className="space-y-3 p-4 rounded-md border bg-card/50">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={cn(
              'h-6 w-6 rounded-full',
              approval.level === 'L1' && 'bg-primary/20 text-primary',
              approval.level === 'L2' && 'bg-warning/20 text-warning',
              approval.level === 'L3' && 'bg-destructive/20 text-destructive'
            )}
          >
            {approval.level}
          </Badge>
          <div>
            <p className="font-medium truncate">{approval.action_type}</p>
            <p className="text-xs text-muted-foreground">{approval.created_at}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isPending && (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={onApprove}
                disabled={!onApprove}
                title="Approve"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={onReject}
                disabled={!onReject}
                title="Reject"
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
          <Badge
            variant="outline"
            className={cn('h-6 w-6 rounded-full', isPending && 'bg-amber/20 text-amber', 'opacity-50')}
          >
            {approval.level}
          </Badge>
        </div>
      </div>

      {!isPending && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Decision: {'Approved'}</span>
        </div>
      )}

      {onCancel && (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  )
}