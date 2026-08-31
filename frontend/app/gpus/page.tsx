'use client'

import { useMemo, useState } from 'react'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  RefreshCw,
  AlertCircle,
  Cpu,
  Sparkles,
  Server,
  Zap,
} from 'lucide-react'
import {
  useGpuModels,
  useGpuProviders,
  useGpuOffers,
} from '@/hooks/useGpus'
import type { GPUModel, GPUOffer, GPUProvider } from '@/types'

function fmtPrice(v: number | null | undefined, currency = 'USD') {
  if (v == null) return '—'
  return `$${v.toFixed(2)}/${currency === 'USD' ? 'hr' : currency}`
}

export default function GpusPage() {
  // Models filters
  const [manufacturer, setManufacturer] = useState<string | undefined>(undefined)
  const [tier, setTier] = useState<string | undefined>(undefined)
  const [minVram, setMinVram] = useState<string>('')

  // Offers filters
  const [offerProvider, setOfferProvider] = useState<string | undefined>(undefined)
  const [offerRegion, setOfferRegion] = useState<string>('')
  const [offerMinVram, setOfferMinVram] = useState<string>('')
  const [offerMaxPrice, setOfferMaxPrice] = useState<string>('')
  const [offerSort, setOfferSort] = useState<string>('hourly_price')
  const [offerSpot, setOfferSpot] = useState<string>('all')

  const modelsQuery = useGpuModels({
    page: 1,
    page_size: 100,
    manufacturer,
    tier,
    min_vram_gb: minVram ? Number(minVram) : undefined,
  })

  const providersQuery = useGpuProviders()

  const offersQuery = useGpuOffers({
    page: 1,
    page_size: 100,
    provider_id: offerProvider,
    region: offerRegion || undefined,
    min_vram_gb: offerMinVram ? Number(offerMinVram) : undefined,
    max_hourly_price: offerMaxPrice ? Number(offerMaxPrice) : undefined,
    is_spot: offerSpot === 'all' ? undefined : offerSpot === 'spot',
    sort_by: offerSort,
    sort_order: 'asc',
  })

  const providers = useMemo(
    () => (providersQuery.data ?? []) as GPUProvider[],
    [providersQuery.data]
  )
  const regions = useMemo(() => {
    const set = new Set<string>()
    ;(offersQuery.data?.data ?? []).forEach((o: GPUOffer) => {
      if (o.region) set.add(o.region)
    })
    return Array.from(set).sort()
  }, [offersQuery.data])

  const refreshAll = () => {
    modelsQuery.refetch()
    providersQuery.refetch()
    offersQuery.refetch()
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">GPU Catalog</h1>
            <p className="text-muted-foreground">
              Browse GPU models, providers, and live offers across the network
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Link href="/gpus/recommend">
              <Button size="sm">
                <Sparkles className="h-4 w-4 mr-2" />
                Get Recommendation
              </Button>
            </Link>
          </div>
        </div>

        {/* Providers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" /> Providers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {providersQuery.isLoading ? (
              <div className="flex gap-2 flex-wrap">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-8 w-28" />
                ))}
              </div>
            ) : providers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active GPU providers configured.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {providers.map((p) => (
                  <Badge
                    key={p.id ?? p.slug}
                    variant={p.is_active ? 'secondary' : 'outline'}
                    className="text-sm py-1 px-3"
                  >
                    {p.name}
                    {p.supports_mock && (
                      <span className="ml-1 text-[10px] opacity-70">mock</span>
                    )}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Tabs defaultValue="models">
          <TabsList>
            <TabsTrigger value="models">
              <Cpu className="h-4 w-4 mr-2" /> Models
            </TabsTrigger>
            <TabsTrigger value="offers">
              <Zap className="h-4 w-4 mr-2" /> Offers
            </TabsTrigger>
          </TabsList>

          {/* Models */}
          <TabsContent value="models" className="space-y-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Manufacturer</label>
                    <Select
                      value={manufacturer ?? 'all'}
                      onValueChange={(v) => setManufacturer(v === 'all' ? undefined : v)}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="NVIDIA">NVIDIA</SelectItem>
                        <SelectItem value="AMD">AMD</SelectItem>
                        <SelectItem value="Intel">Intel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Tier</label>
                    <Select
                      value={tier ?? 'all'}
                      onValueChange={(v) => setTier(v === 'all' ? undefined : v)}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="consumer">Consumer</SelectItem>
                        <SelectItem value="prosumer">Prosumer</SelectItem>
                        <SelectItem value="datacenter">Datacenter</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Min VRAM (GB)</label>
                    <Input
                      type="number"
                      className="w-32"
                      placeholder="0"
                      value={minVram}
                      onChange={(e) => setMinVram(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {modelsQuery.isLoading ? (
              <Card>
                <CardContent className="py-8 space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </CardContent>
              </Card>
            ) : modelsQuery.error ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                  <p>Unable to load GPU models.</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <ModelsTable models={(modelsQuery.data?.data ?? []) as GPUModel[]} />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Offers */}
          <TabsContent value="offers" className="space-y-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Provider</label>
                    <Select
                      value={offerProvider ?? 'all'}
                      onValueChange={(v) => setOfferProvider(v === 'all' ? undefined : v)}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {providers.map((p) => (
                          <SelectItem key={p.id ?? p.slug} value={p.id ?? p.slug}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Region</label>
                    <Select
                      value={offerRegion || 'all'}
                      onValueChange={(v) => setOfferRegion(v === 'all' ? '' : v)}
                    >
                      <SelectTrigger className="w-36">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {regions.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Min VRAM (GB)</label>
                    <Input
                      type="number"
                      className="w-32"
                      placeholder="0"
                      value={offerMinVram}
                      onChange={(e) => setOfferMinVram(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Max $/hr</label>
                    <Input
                      type="number"
                      className="w-28"
                      placeholder="∞"
                      value={offerMaxPrice}
                      onChange={(e) => setOfferMaxPrice(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Type</label>
                    <Select value={offerSpot} onValueChange={setOfferSpot}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="spot">Spot</SelectItem>
                        <SelectItem value="on-demand">On-demand</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Sort</label>
                    <Select value={offerSort} onValueChange={setOfferSort}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hourly_price">Price ↑</SelectItem>
                        <SelectItem value="vram_gb">VRAM</SelectItem>
                        <SelectItem value="region">Region</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {offersQuery.isLoading ? (
              <Card>
                <CardContent className="py-8 space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <OffersTable offers={(offersQuery.data?.data ?? []) as GPUOffer[]} />
                  <div className="mt-3 text-xs text-muted-foreground">
                    Showing {offersQuery.data?.data.length ?? 0} of{' '}
                    {offersQuery.data?.total ?? 0} offers
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}

function ModelsTable({ models }: { models: GPUModel[] }) {
  if (models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No GPU models match the current filters.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead>Vendor</TableHead>
          <TableHead className="text-right">VRAM</TableHead>
          <TableHead className="text-right">FP16</TableHead>
          <TableHead className="text-right">FP32</TableHead>
          <TableHead className="text-right">Bandwidth</TableHead>
          <TableHead>Tier</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((m) => (
          <TableRow key={m.id ?? m.name}>
            <TableCell className="font-medium">{m.name}</TableCell>
            <TableCell>{m.manufacturer}</TableCell>
            <TableCell className="text-right">{m.vram_gb} GB</TableCell>
            <TableCell className="text-right">
              {m.fp16_tflops != null ? `${m.fp16_tflops} TFLOPS` : '—'}
            </TableCell>
            <TableCell className="text-right">
              {m.fp32_tflops != null ? `${m.fp32_tflops} TFLOPS` : '—'}
            </TableCell>
            <TableCell className="text-right">
              {m.memory_bandwidth_gbps != null
                ? `${m.memory_bandwidth_gbps} GB/s`
                : '—'}
            </TableCell>
            <TableCell>
              {m.tier && <Badge variant="outline">{m.tier}</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function OffersTable({ offers }: { offers: GPUOffer[] }) {
  if (offers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No offers match the current filters.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Instance</TableHead>
          <TableHead>Region</TableHead>
          <TableHead className="text-right">VRAM</TableHead>
          <TableHead className="text-right">RAM</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {offers.map((o) => (
          <TableRow key={o.id ?? o.offer_id ?? `${o.provider_id}-${o.instance_type}`}>
            <TableCell className="font-medium">{o.instance_type ?? '—'}</TableCell>
            <TableCell>{o.region ?? '—'}</TableCell>
            <TableCell className="text-right">{o.vram_gb ?? '—'} GB</TableCell>
            <TableCell className="text-right">{o.ram_gb ?? '—'} GB</TableCell>
            <TableCell className="text-right font-medium">
              {fmtPrice(o.hourly_price, o.currency ?? undefined)}
            </TableCell>
            <TableCell>
              {o.is_spot ? (
                <Badge variant="warning">Spot</Badge>
              ) : (
                <Badge variant="secondary">On-demand</Badge>
              )}
            </TableCell>
            <TableCell>
              <Badge
                variant={
                  o.availability === 'available' ? 'success' : 'outline'
                }
              >
                {o.availability ?? 'unknown'}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
