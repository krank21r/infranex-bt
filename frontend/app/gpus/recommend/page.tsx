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

export default function GpuRecommendPage() {
  const [netuid, setNetuid] = useState<string>('')
  const [minVram, setMinVram] = useState<string>('24')
  const [recommendedGpu, setRecommendedGpu] = useState<string>('')
  const [preferredRegion, setPreferredRegion] = useState<string>('')

  const recommend = useGpuRecommendation()
  const subnetsQuery = useSubnets({ page: 1, page_size: 100 })

  const subnets = (subnetsQuery.data?.data ?? []).map(adaptSubnet)

  const onSubmit = () => {
    const requirements: Record<string, unknown> = {}
    if (minVram) requirements.min_vram_gb = Number(minVram)
    if (recommendedGpu.trim()) requirements.recommended_gpu = recommendedGpu.trim()
    recommend.mutate({
      netuid: netuid ? Number(netuid) : null,
      requirements: Object.keys(requirements).length ? requirements : null,
      preferred_region: preferredRegion.trim() || null,
    })
  }

  const result = recommend.data as GPURecommendation | undefined

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <Link
            href="/gpus"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to catalog
          </Link>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" /> GPU Recommendation
          </h1>
          <p className="text-muted-foreground">
            Rank available GPU offers against a subnet&apos;s hardware requirements
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Form */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-base">Requirements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  From subnet (auto-fills requirements)
                </label>
                <Select value={netuid || 'none'} onValueChange={setNetuid}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a subnet (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None — manual input</SelectItem>
                    {subnets.map((s) => (
                      <SelectItem key={s.netuid} value={String(s.netuid)}>
                        #{s.netuid} · {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Minimum VRAM (GB)
                </label>
                <Input
                  type="number"
                  value={minVram}
                  onChange={(e) => setMinVram(e.target.value)}
                  placeholder="24"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Recommended GPU model
                </label>
                <Input
                  value={recommendedGpu}
                  onChange={(e) => setRecommendedGpu(e.target.value)}
                  placeholder="e.g. H100, A100"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Preferred region
                </label>
                <Input
                  value={preferredRegion}
                  onChange={(e) => setPreferredRegion(e.target.value)}
                  placeholder="e.g. us-east-1"
                />
              </div>

              <Button
                className="w-full"
                onClick={onSubmit}
                disabled={recommend.isPending}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {recommend.isPending ? 'Ranking…' : 'Recommend GPUs'}
              </Button>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="lg:col-span-2 space-y-4">
            {recommend.isError && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                  <p>Recommendation failed.</p>
                  <p className="text-xs mt-1">
                    {recommend.error instanceof Error
                      ? recommend.error.message
                      : 'Unknown error'}
                  </p>
                </CardContent>
              </Card>
            )}

            {recommend.isPending && (
              <Card>
                <CardContent className="py-8 space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </CardContent>
              </Card>
            )}

            {result && (
              <>
                <Card>
                  <CardContent className="py-4 flex items-center justify-between">
                    <div className="text-sm">
                      <span className="text-muted-foreground">
                        Eligible offers:{' '}
                      </span>
                      <span className="font-semibold">
                        {result.total_eligible}
                      </span>
                    </div>
                    {result.model_version && (
                      <Badge variant="outline">
                        ranker {result.model_version}
                      </Badge>
                    )}
                  </CardContent>
                </Card>

                {result.ranked.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      <Cpu className="h-8 w-8 mx-auto mb-2" />
                      <p className="text-sm">
                        No offers meet the specified requirements.
                      </p>
                      <p className="text-xs mt-1">
                        Try lowering the minimum VRAM or clearing the recommended
                        GPU.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Ranked Offers</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <RankedTable ranked={result.ranked} />
                    </CardContent>
                  </Card>
                )}
              </>
            )}

            {!result && !recommend.isPending && !recommend.isError && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-60" />
                  <p className="text-sm">
                    Select a subnet or enter requirements, then generate a
                    recommendation.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}

function RankedTable({ ranked }: { ranked: RankedGPUOffer[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>GPU</TableHead>
          <TableHead>Region</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead>Why</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ranked.map((r, i) => {
          const o = r.offer
          const reasons: string[] = []
          if (r.match_bonus > 0) reasons.push('recommended GPU match')
          if (r.region_bonus > 0) reasons.push('preferred region')
          return (
            <TableRow key={o.id ?? o.offer_id ?? i}>
              <TableCell className="font-semibold text-muted-foreground">
                {i + 1}
              </TableCell>
              <TableCell className="font-medium">
                {o.gpu_model_name ?? o.instance_type ?? '—'}
                {o.is_spot && (
                  <Badge variant="warning" className="ml-2">
                    Spot
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1 text-sm">
                  <MapPin className="h-3 w-3 opacity-60" />
                  {o.region ?? '—'}
                </span>
              </TableCell>
              <TableCell className="text-right font-medium">
                {o.hourly_price != null
                  ? `$${o.hourly_price.toFixed(2)}/hr`
                  : '—'}
              </TableCell>
              <TableCell className="text-right">
                <span className="font-semibold">
                  {r.total_score.toFixed(1)}
                </span>
              </TableCell>
              <TableCell>
                {reasons.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    eligible (price tie-break)
                  </span>
                ) : (
                  <span className="inline-flex flex-wrap gap-1">
                    {reasons.map((reason) => (
                      <Badge
                        key={reason}
                        variant="success"
                        className="text-[10px]"
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {reason}
                      </Badge>
                    ))}
                  </span>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
