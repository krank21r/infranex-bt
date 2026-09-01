'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Wallet } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RegisterMinerForm } from '@/components/miners/RegisterMinerForm'
import { useState } from 'react'

export default function RegisterMinerPage() {
  const router = useRouter()
  const [registeredId, setRegisteredId] = useState<string | null>(null)

  if (registeredId) {
    return (
      <DashboardLayout>
        <div className="max-w-2xl mx-auto py-12">
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="mx-auto h-12 w-12 rounded-full bg-success/10 flex items-center justify-center">
                <CheckCircle2 className="h-7 w-7 text-success" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold">Miner Registered</h2>
                <p className="text-muted-foreground mt-1">
                  Your miner is now tracked in your portfolio.
                </p>
              </div>
              <div className="flex justify-center gap-2 pt-2">
                <Button onClick={() => router.push('/miners/portfolio')}>
                  View Portfolio
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setRegisteredId(null)
                  }}
                >
                  Register Another
                </Button>
                <Button variant="ghost" asChild>
                  <Link href={`/miners/${registeredId}`}>Open Details</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/miners/portfolio" aria-label="Back to portfolio">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Register a Miner</h1>
            <p className="text-muted-foreground">
              Connect a Bittensor hotkey to start tracking a miner in your portfolio.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wallet className="h-4 w-4" />
              Before you start
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              You will need the <span className="font-medium text-foreground">SS58 hotkey address</span>{' '}
              of the Bittensor wallet that controls your miner on-chain.
            </p>
            <p>
              The hotkey is verified on-chain for the selected subnet before registration. Make sure
              your hotkey is already registered on that subnet — registration itself happens on
              Bittensor, this step only tracks it in Infranex.
            </p>
          </CardContent>
        </Card>

        <RegisterMinerForm
          onSuccess={(id) => setRegisteredId(id)}
          onCancel={() => router.push('/miners/portfolio')}
        />
      </div>
    </DashboardLayout>
  )
}