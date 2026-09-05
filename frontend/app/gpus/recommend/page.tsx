'use client'

import { useState } from 'react'
import Link from 'next/link'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sparkles,
  AlertCircle,
  Cpu,
  ArrowLeft,
  CheckCircle2,
  MapPin,
} from 'lucide-react'
import { useGpuRecommendation } from '@/hooks/useGpus'
import { useSubnets } from '@/hooks/useSubnets'
import { adaptSubnet } from '@/lib/adapters'
import type { GPURecommendation, RankedGPUOffer } from '@/types'
import { GpuRecommendationBadge } from '@/components/gpu-recommendation-badge'

export default function GpuRecommendPage() {
  const [netuid, setNetuid] = useState<string>('')
  const [minVram, setMinVram] = useState<string>('24')
  const [recommendedGpu, setRecommendedGpu] = useState<string>('')
  const [preferredRegion, setPreferredRegion] = useState<string>('')

  const recommend = useGpuRecommendation()
  const subnetsQuery = useSubnets({ page: 1, page_size: 100 })
  const subnets = (subnetsQuery.data?.data ?? []).map(adaptSubnet)

  const onSubmit = () => {
    if (!recommendedGpu.trim()) return
    const requirements = {
      recommended_gpu: recommendedGpu.trim(),
      min_vram: parseInt(minVram),
      preferred_region: preferredRegion || undefined,
    }
    recommend.mutate(requirements)
  }

  const result = recommend.data as GPURecommendation | undefined
  const { data: subnetsData } = subnetsQuery

  return (
    <DashboardLayout>
      {/* Premium Page Header with Fraunces serif font */}
      <header className="py-8 bg-background">
        <div className="max-w-7xl mx-auto px-4">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold leading-none tracking-tight text-primary">
            GPU Recommendation
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Best GPU for your subnet — ranked by profitability & ROI
          </p>
        </div>
      </header>

      {/* Recommendation Form Section */}
      <section className="py-6">
        <div className="max-w-7xl mx-auto px-4">
          <form
            onSubmit={e => {
              e.preventDefault()
              onSubmit()
            }}
            className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Select GPU
                </label>
                <Input
                  value={recommendedGpu}
                  onChange={e => setRecommendedGpu(e.target.value)}
                  placeholder="e.g. H100 80GB"
                  disabled={recommend.isPending}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Min VRAM (GB)
                </label>
                <Input
                  value={minVram}
                  onChange={e => setMinVram(e.target.value)}
                  placeholder="24"
                  type="number"
                  disabled={recommend.isPending}
                  className="w-full"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Preferred Region
                </label>
                <Input
                  value={preferredRegion}
                  onChange={e => setPreferredRegion(e.target.value)}
                  placeholder="e.g. US-East"
                  disabled={recommend.isPending}
                  className="w-full"
                />
              </div>
            </div>

            <button
              type="submit"
              className="cta-button w-full"
              disabled={recommend.isPending}
            >
              {recommend.isPending ? (
                <>
                  <span className="animate-spin mr-2 hidden"></span>
                  Processing...
                </>
              ) : (
                'Get Recommendation'
              )}
            </button>
          </form>
        </div>
      </section>

      {/* Premium GPU Recommendation Result */}
      {result && (
        <section className="py-8">
          <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-primary mb-6">
              Recommendation Result
            </h2>
            
            <GpuRecommendationBadge
              model={result.recommended_gpu || 'Best GPU for this subnet'}
              provider={result.preferred_provider || 'Provider X'}
              vram={result.min_vram || '80'}
              price={result.estimated_hourly_price || '$3.50'}
              roi={result.estimated_roi || '45'}
              rank={result.rank || 1}
              isTop={result.rank === 1}
              isQualified={result.total_eligible > 0}
            />
          </div>
        </section>
      )}

      {/* Ranked Offers Section */}
      {result && result.ranked && result.ranked.length > 0 && (
        <section className="py-8 bg-background">
          <div className="max-w-7xl mx-auto px-4">
            <h2 className="text-3xl sm:text-4xl font-display font-bold text-primary mb-6">
              Ranked GPU Offers
            </h2>
            <p className="text-muted-foreground mb-6">
              {result.total_eligible} eligible offers ranked by profitability
            </p>
            <RankedTable ranked={result.ranked} />
          </div>
        </section>
      )}

      {/* Fallback when no result yet */}
      {!result && !recommend.isPending && !recommend.isError && (
        <section className="py-8 text-center">
          <p className="text-muted-foreground">
            Click 'Get Recommendation' above to generate GPU rankings
          </p>
        </section>
      )}
    </DashboardLayout>
  )
}

/* --- Ranked Table Component with frontend-design standards --- */

function RankedTable({ ranked }: { ranked: RankedGPUOffer[] }) {
  return (
    <div className="space-y-4">
      {ranked.map((offer, index) => (
        <div
          key={offer.model}
          className="ranked-offer-card">
          <div className="flex items-start justify-between">
            <div>
              {/* TOP badge for #1 rank */}
              {index === 0 && (
                <span className="top-badge">TOP</span>
              )}
              {/* QUALIFIED badge for top 3 */}
              {index < 3 && (
                <span className="average-badge">QUALIFIED</span>
              )}
              <strong className="gpu-model-name" style={{ marginBottom: '0.5rem' }}>
                {offer.model}
              </strong>
              <div className="gpu-specs">
                <strong>VRAM:</strong> {offer.vram}GB &nbsp;|&nbsp; 
                <strong>Provider:</strong> {offer.provider} &nbsp;|&nbsp; 
                <strong>Est. Price:</strong> {offer.estimated_price || '$0'}/hr
              </div>
            </div>
            <div>
              <button
                className="cta-button"
                onClick={() => /* handle selection */}
              >
                Select
              </button>
            </div>
          </div>
        </div>
      ))
      {/* Empty state when no ranked offers */}
      {ranked.length === 0 && (
        <p className="text-sm text-muted-foreground text-center">
          No ranked offers available. Click 'Get Recommendation' to generate.
        </p>
      )}
    </div>
  )
}