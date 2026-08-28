'use client'

import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Settings as SettingsIcon, Construction } from 'lucide-react'

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Platform configuration, integrations, and account preferences
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SettingsIcon className="h-5 w-5" />
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="py-12 text-center text-muted-foreground space-y-3">
            <Construction className="h-10 w-10 mx-auto text-amber-500" />
            <p className="text-sm font-medium">Coming in Phase 1B</p>
            <p className="text-xs max-w-md mx-auto">
              User preferences, scoring-weight tuning, alert thresholds, and
              integration credentials will be configurable here.
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
