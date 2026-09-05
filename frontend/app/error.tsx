'use client'

import { useEffect } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Dashboard render error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-warning" />
        <h2 className="text-display mt-4 text-2xl">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The dashboard failed to render. The data API is healthy — open the
          Opportunities page to view live scores.
        </p>
        <p className="mt-3 break-all text-xs text-muted-foreground/80">
          {error.message}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => reset()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
          <a
            href="/opportunities"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
          >
            View Opportunities
          </a>
        </div>
      </div>
    </div>
  )
}
