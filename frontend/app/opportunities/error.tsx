'use client'

import { useEffect } from 'react'
import { AlertCircle, RefreshCw, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function OpportunitiesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Opportunities render error:', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <BarChart3 className="mx-auto h-10 w-10 text-warning" />
        <h2 className="text-display mt-4 text-2xl">Couldn&rsquo;t load opportunities</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The opportunity-scoring endpoint timed out or returned an error.
          Scores are recalculated hourly; if the data is genuinely empty, the
          page will still render an empty state once the request succeeds.
        </p>
        <p className="mt-3 break-all text-xs text-muted-foreground/80">
          {error.message}
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" onClick={() => reset()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
          <a
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-accent"
          >
            Go to Dashboard
          </a>
        </div>
      </div>
    </div>
  )
}
