'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, Construction } from 'lucide-react'

export default function AnalyticsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Historical trends, accuracy tracking, and platform-wide metrics
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Platform Analytics
            </CardTitle>
          </CardHeader>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <Construction className="h-10 w-10 mx-auto text-amber-500" />
            <p className="text-sm font-medium">Coming in Phase 1C</p>
            <p className="text-xs max-w-md mx-auto">
              Once the Bittensor scanner worker is emitting historical data,
              this view will render trend charts, accuracy reports, and
              per-subnet breakdowns.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
