'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Coins, Construction } from 'lucide-react'

export default function MinersPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Miners</h1>
          <p className="text-muted-foreground">
            Tracked miner positions, health, and earnings
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Miner Registry
            </CardTitle>
          </CardHeader>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <Construction className="h-10 w-10 mx-auto text-amber-500" />
            <p className="text-sm font-medium">Coming in Phase 1B</p>
            <p className="text-xs max-w-md mx-auto">
              Miner tracking requires the Bittensor chain scanner and the
              deployment manager to be wired up. The data model and API are
              already in place.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
