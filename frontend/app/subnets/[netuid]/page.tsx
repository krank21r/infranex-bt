'use client'

import { useParams } from 'next/navigation'
import { DashboardLayout } from '@/components/layout/dashboard-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, RefreshCw, ExternalLink, Network, Users, Gauge, BarChart3, Info, AlertTriangle, Link2, Github, Twitter, Globe } from 'lucide-react'
import { useSubnet, useSubnetOpportunity } from '@/hooks/useSubnets'
import { useSubnetChanges } from '@/hooks/useChangeDetection'
import { MetricCard } from '@/components/cards/metric-card'
import { OpportunityCard } from '@/components/cards/opportunity-card'
import { ChangesCard } from '@/components/cards/changes-card'
import { RevenueChart } from '@/components/charts/revenue-chart'
import { formatNumber, formatPercent, formatTao, getStatusColor, cn } from '@/lib/utils'
import { adaptSubnet, BackendSubnet, BackendOpportunityDetail, BackendScoreComponent } from '@/lib/adapters'
import type { Opportunity, OpportunityFactor } from '@/types'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Progress } from '@/components/ui/progress'
import { useMemo, useState } from 'react'

export default function SubnetDetailPage() {
  const params = useParams()
  const netuid = Number(params.netuid)

  const { data: subnetData, isLoading: subnetLoading, error: subnetError, refetch: refetchSubnet } = useSubnet(netuid)
  const { data: opportunityData, isLoading: opportunityLoading } = useSubnetOpportunity(netuid)
  const { data: changesData } = useSubnetChanges(netuid)

  const latestMetrics = subnetData?.latest_metrics ?? null

  // Convert the API response to BackendSubnet format for the adapter
  const backendSubnet = useMemo(() => {
    if (!subnetData) return null
    return {
      id: String(subnetData.netuid),
      netuid: subnetData.netuid,
      name: subnetData.name,
      description: subnetData.description,
      subnet_type: 'unknown',
      owner_hotkey: (subnetData as { owner_hotkey?: string })?.owner_hotkey,
      max_neurons: 256, // default
      tempo: subnetData.tempo,
      difficulty: 0,
      is_active: subnetData.status === 'active',
      registration_open: true,
      created_at: subnetData.created_at,
      updated_at: subnetData.updated_at,
      latest_metrics: latestMetrics ? {
        netuid: subnetData.netuid,
        block: latestMetrics.block ?? null,
        emission: latestMetrics.emission ?? null,
        average_incentive: latestMetrics.average_incentive ?? null,
        total_stake: latestMetrics.total_stake ?? null,
        top_5_concentration: latestMetrics.top_5_concentration ?? null,
        miner_count: latestMetrics.miner_count ?? null,
        validator_count: latestMetrics.validator_count ?? null,
        trust: latestMetrics.trust ?? null,
        consensus: latestMetrics.consensus ?? null,
        recorded_at: latestMetrics.recorded_at ?? null,
      } : null,
    } as BackendSubnet
  }, [subnetData, latestMetrics])

  const subnet = useMemo(() => backendSubnet ? adaptSubnet(backendSubnet) : null, [backendSubnet])

  const [activeTab, setActiveTab] = useState('overview')

  // Generate mock time-series data for charts (in real app, this would come from API).
  // Declared before any early returns so hook order is stable across renders.
  const emissionHistory = useMemo(() => generateTimeSeries(latestMetrics?.emission ?? subnet?.emission ?? 0, 30), [latestMetrics?.emission, subnet?.emission])
  const stakeHistory = useMemo(() => generateTimeSeries(latestMetrics?.total_stake ?? subnet?.tao_total ?? 0, 30), [latestMetrics?.total_stake, subnet?.tao_total])
  const incentiveHistory = useMemo(() => generateTimeSeries(latestMetrics?.average_incentive ?? 0, 30), [latestMetrics?.average_incentive])
  const minerCountHistory = useMemo(() => generateTimeSeries(latestMetrics?.miner_count ?? subnet?.miners_count ?? 0, 30), [latestMetrics?.miner_count, subnet?.miners_count])

  if (subnetError) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Subnet {netuid}</h1>
          </div>
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 text-amber-500" />
              <p>Unable to load subnet {netuid}</p>
              <Button variant="outline" onClick={() => refetchSubnet()} className="mt-4">
                <RefreshCw className="h-4 w-4 mr-2" /> Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    )
  }

  if (subnetLoading || !subnet) {
    return (
      <DashboardLayout>
        <SubnetDetailSkeleton />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight truncate">{subnet.name}</h1>
              <Badge variant="outline" className="text-sm">
                NetUID: {subnet.netuid}
              </Badge>
              <Badge
                variant={subnet.status === 'active' ? 'default' : 'outline'}
                className={cn('capitalize', getStatusColor(subnet.status).bg, getStatusColor(subnet.status).text)}
              >
                {subnet.status}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
              {subnet.description || 'No description available.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Network className="h-3 w-3" /> Owner: {truncate(subnet.owner, 12)}
              </span>
              <span className="flex items-center gap-1">
                <Gauge className="h-3 w-3" /> Tempo: {subnet.tempo}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" /> Max Neurons: {formatNumber(backendSubnet?.max_neurons ?? 256)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
             <Button variant="default" size="sm" asChild>
               <a href="/opportunities" target="_blank" rel="noopener noreferrer">
                 <ExternalLink className="h-4 w-4 mr-2" /> View Opportunities
               </a>
             </Button>
          </div>
        </div>

        {/* Key Metrics Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            title="Current Emission"
            value={latestMetrics?.emission ?? subnet.emission}
            format="tao"
            trend={emissionHistory.length > 1 ? (emissionHistory[emissionHistory.length - 1].value > emissionHistory[0].value ? 'up' : 'down') : 'neutral'}
            subtitle="Per tempo"
          />
          <MetricCard
            title="Total Stake"
            value={latestMetrics?.total_stake ?? subnet.tao_total}
            format="tao"
            trend={stakeHistory.length > 1 ? (stakeHistory[stakeHistory.length - 1].value > stakeHistory[0].value ? 'up' : 'down') : 'neutral'}
            subtitle="All neurons"
          />
          <MetricCard
            title="Avg Incentive"
            value={latestMetrics?.average_incentive ?? 0}
            format="percent"
            trend={incentiveHistory.length > 1 ? (incentiveHistory[incentiveHistory.length - 1].value > incentiveHistory[0].value ? 'up' : 'down') : 'neutral'}
            subtitle="Network average"
          />
          <MetricCard
            title="Active Miners"
            value={latestMetrics?.miner_count ?? subnet.miners_count}
            format="number"
            trend={minerCountHistory.length > 1 ? (minerCountHistory[minerCountHistory.length - 1].value > minerCountHistory[0].value ? 'up' : 'down') : 'neutral'}
            subtitle={backendSubnet?.max_neurons ? `of ${backendSubnet.max_neurons} max` : 'No limit'}
          />
          <MetricCard
            title="Validators"
            value={latestMetrics?.validator_count ?? subnet.validators_count}
            format="number"
            subtitle="Active validators"
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="opportunity">Opportunity</TabsTrigger>
            <TabsTrigger value="metrics">Metrics History</TabsTrigger>
            <TabsTrigger value="neurons">Neurons</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Info className="h-4 w-4" /> Subnet Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <InfoRow label="Subnet Type" value={(subnetData as unknown as { subnet_type?: string })?.subnet_type || 'Unknown'} />
                  <InfoRow label="Difficulty" value={(subnetData as unknown as { difficulty?: number })?.difficulty ? formatNumber((subnetData as unknown as { difficulty: number }).difficulty) : '—'} />
                  <InfoRow label="Registration" value={(subnetData as unknown as { registration_open?: boolean })?.registration_open ? 'Open' : 'Closed'} />
                  <InfoRow label="Created" value={subnetData?.created_at ? new Date(subnetData.created_at).toLocaleDateString() : '—'} />
                  <InfoRow label="Updated" value={subnetData?.updated_at ? new Date(subnetData.updated_at).toLocaleDateString() : '—'} />
                  <InfoRow label="Block" value={latestMetrics?.block ? formatNumber(latestMetrics.block) : '—'} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" /> Network Health
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <MetricRow 
                    label="Trust" 
                    value={latestMetrics?.trust ?? 0} 
                    max={1} 
                    format="percent"
                    color="primary"
                  />
                  <MetricRow 
                    label="Consensus" 
                    value={latestMetrics?.consensus ?? 0} 
                    max={1} 
                    format="percent"
                    color="success"
                  />
                  <MetricRow 
                    label="Top 5 Concentration" 
                    value={latestMetrics?.top_5_concentration ?? 0} 
                    max={1} 
                    format="percent"
                    color={latestMetrics && latestMetrics.top_5_concentration && latestMetrics.top_5_concentration > 0.5 ? 'destructive' : 'warning'}
                    warning={Boolean(latestMetrics && latestMetrics.top_5_concentration && latestMetrics.top_5_concentration > 0.5)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Link2 className="h-4 w-4" /> Links
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {subnetData?.metadata?.website && (
                    <LinkRow icon={Globe} label="Website" href={subnetData.metadata.website} />
                  )}
                  {subnetData?.metadata?.github && (
                    <LinkRow icon={Github} label="GitHub" href={subnetData.metadata.github} />
                  )}
                  {subnetData?.metadata?.twitter && (
                    <LinkRow icon={Twitter} label="Twitter" href={subnetData.metadata.twitter} />
                  )}
                  {subnetData?.metadata?.discord && (
                    <LinkRow icon={Info} label="Discord" href={subnetData.metadata.discord} />
                  )}
                  {subnetData?.metadata?.documentation && (
                    <LinkRow icon={Info} label="Documentation" href={subnetData.metadata.documentation} />
                  )}
                  {![subnetData?.metadata?.website, subnetData?.metadata?.github, subnetData?.metadata?.twitter, subnetData?.metadata?.discord, subnetData?.metadata?.documentation].some(Boolean) && (
                    <p className="text-sm text-muted-foreground">No external links available</p>
                  )}
                </CardContent>
              </Card>
            </div>

             {/* Emission & Stake Charts */}
             <div className="grid gap-4 md:grid-cols-2">
               <Card>
                 <CardHeader>
                   <CardTitle className="text-lg">Emission History (30 days)</CardTitle>
                 </CardHeader>
                 <CardContent>
                   <RevenueChart data={emissionHistory} height={300} color="hsl(var(--primary))" />
                 </CardContent>
               </Card>
               <Card>
                 <CardHeader>
                   <CardTitle className="text-lg">Total Stake History (30 days)</CardTitle>
                 </CardHeader>
                 <CardContent>
                   <RevenueChart data={stakeHistory} height={300} color="hsl(var(--success))" />
                 </CardContent>
               </Card>
             </div>

             {/* Changes */}
             {changesData && changesData.length > 0 && (
               <ChangesCard changes={changesData} />
             )}
          </TabsContent>

          {/* Opportunity Tab */}
          <TabsContent value="opportunity" className="space-y-6">
            {opportunityLoading ? (
              <OpportunitySkeleton />
            ) : opportunityData ? (
              <>
                <OpportunityCard opportunity={adaptOpportunityDetail(opportunityData)} />
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" /> Score Breakdown
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {opportunityData.components && opportunityData.components.length > 0 ? (
                      <div className="space-y-3">
                        {opportunityData.components.map((comp: { name?: string; score?: number; weighted?: number; weight?: number; explanation?: string }, idx: number) => (
                          <ComponentScoreRow key={idx} component={comp} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No component breakdown available</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Info className="h-4 w-4" /> Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {opportunityData.summary || 'No summary available'}
                    </p>
                  </CardContent>
                </Card>
              </>
            ) : (
               <Card>
                <CardContent className="py-12 text-center text-muted-foreground space-y-4">
                  <AlertTriangle className="h-8 w-8 mx-auto text-amber-500" />
                  <p>No opportunity score available for this subnet</p>
                  <p className="text-xs">Run the scoring worker to compute opportunity scores</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Metrics History Tab */}
          <TabsContent value="metrics" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Average Incentive (30 days)</CardTitle>
                </CardHeader>
                <CardContent>
                  <RevenueChart data={incentiveHistory} height={300} color="hsl(var(--warning))" />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Miner Count (30 days)</CardTitle>
                </CardHeader>
                <CardContent>
                  <RevenueChart data={minerCountHistory} height={300} color="hsl(var(--primary))" />
                </CardContent>
              </Card>
            </div>

            {/* Raw Metrics Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Latest Metrics Snapshot</CardTitle>
              </CardHeader>
              <CardContent>
                {latestMetrics ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <MetricSnapshot label="Block" value={latestMetrics.block ? formatNumber(latestMetrics.block) : '—'} />
                    <MetricSnapshot label="Emission" value={latestMetrics.emission ? formatTao(latestMetrics.emission) : '—'} />
                    <MetricSnapshot label="Avg Incentive" value={latestMetrics.average_incentive ? formatPercent(latestMetrics.average_incentive * 100) : '—'} />
                    <MetricSnapshot label="Total Stake" value={latestMetrics.total_stake ? formatTao(latestMetrics.total_stake) : '—'} />
                    <MetricSnapshot label="Top 5 Concentration" value={latestMetrics.top_5_concentration ? formatPercent(latestMetrics.top_5_concentration * 100) : '—'} />
                    <MetricSnapshot label="Miners" value={latestMetrics.miner_count ? formatNumber(latestMetrics.miner_count) : '—'} />
                    <MetricSnapshot label="Validators" value={latestMetrics.validator_count ? formatNumber(latestMetrics.validator_count) : '—'} />
                    <MetricSnapshot label="Trust" value={latestMetrics.trust ? formatPercent(latestMetrics.trust * 100) : '—'} />
                    <MetricSnapshot label="Consensus" value={latestMetrics.consensus ? formatPercent(latestMetrics.consensus * 100) : '—'} />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No metrics available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Neurons Tab */}
          <TabsContent value="neurons" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Top Neurons</CardTitle>
                  <Badge variant="outline">Mock Data</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <NeuronsTable />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}

// --- Helper Components ---

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right max-w-[60%] truncate">{value}</span>
    </div>
  )
}

function MetricRow({ label, value, max, format, color = 'primary', warning }: { label: string; value: number; max: number; format: 'percent' | 'number'; color?: string; warning?: boolean }) {
  const percentage = max > 0 ? (value / max) * 100 : 0
  const formattedValue = format === 'percent' ? formatPercent(value * 100) : formatNumber(value)
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{formattedValue}</span>
      </div>
      <Progress 
        value={percentage} 
        max={100} 
        className="h-2" 
        style={{ '--progress-color': `hsl(var(--${color}))` } as React.CSSProperties}
      />
      {warning && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> High concentration risk
        </p>
      )}
    </div>
  )
}

function LinkRow({ icon: Icon, label, href }: { icon: React.ComponentType<{ className?: string }>; label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-primary hover:underline">
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </a>
  )
}

function MetricSnapshot({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-muted/50 rounded-lg">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-medium">{value}</p>
    </div>
  )
}

function ComponentScoreRow({ component }: { component: { name?: string; score?: number; weighted?: number; weight?: number; explanation?: string } }) {
  const COMPONENT_LABELS: Record<string, string> = {
    economic_potential: 'Economic Potential',
    competition: 'Competition',
    reward_stability: 'Reward Stability',
    market_conditions: 'Market Conditions',
    new_miner_accessibility: 'New Miner Accessibility',
    network_health: 'Network Health',
    hardware_suitability: 'Hardware Suitability',
    profitability_potential: 'Profitability Potential',
  }

  const label =
    (component.name ? COMPONENT_LABELS[component.name] : undefined) ??
    component.name ??
    'Component'
  const score = component.score ?? 0
  const weighted = component.weighted ?? 0
  const weight = component.weight ?? 0
  const explanation = component.explanation ?? ''

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-medium truncate">{label}</span>
          <Badge variant={score >= 60 ? 'success' : score <= 40 ? 'destructive' : 'outline'} className="text-xs shrink-0">
            {score.toFixed(1)}
          </Badge>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-muted-foreground">Weight: {formatPercent(weight * 100)}</p>
          <p className="text-xs font-medium text-primary">Contribution: {weighted.toFixed(2)}</p>
        </div>
      </div>
      <Progress value={score} max={100} className="h-1.5" />
      {explanation && (
        <p className="text-xs text-muted-foreground pl-1">{explanation}</p>
      )}
    </div>
  )
}

function OpportunitySkeleton() {
  return (
    <>
      <Card>
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-8 w-1/4" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
          <Skeleton className="h-4 w-1/2" />
          <div className="h-4 bg-muted/50 rounded" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><Skeleton className="h-6 w-1/4" /></CardHeader>
        <CardContent><div className="space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div></CardContent>
      </Card>
    </>
  )
}

function SubnetDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-1/4" />
        <Skeleton className="h-4 w-1/2 mt-2" />
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}><CardContent className="p-6"><Skeleton className="h-8 w-3/4" /><Skeleton className="h-4 w-1/2 mt-2" /></CardContent></Card>
        ))}
      </div>
      <Card><CardHeader><Skeleton className="h-6 w-1/4" /></CardHeader><CardContent><div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div></CardContent></Card>
    </div>
  )
}

// Mock neurons table (replace with real API when available)
function NeuronsTable() {
  const mockNeurons = useMemo(() => generateMockNeurons(), [])

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>UID</TableHead>
            <TableHead>Hotkey</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Stake</TableHead>
            <TableHead>Incentive</TableHead>
            <TableHead>Trust</TableHead>
            <TableHead>Consensus</TableHead>
            <TableHead>Rank</TableHead>
            <TableHead>Emission</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mockNeurons.map((neuron) => (
            <TableRow key={neuron.uid}>
              <TableCell className="font-mono text-sm">{neuron.uid}</TableCell>
              <TableCell className="font-mono text-xs max-w-[120px] truncate">{neuron.hotkey}</TableCell>
              <TableCell>
                <Badge variant={neuron.type === 'validator' ? 'default' : 'outline'}>
                  {neuron.type}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-sm">{formatTao(neuron.stake)}</TableCell>
              <TableCell className="font-mono text-sm">{formatPercent(neuron.incentive * 100)}</TableCell>
              <TableCell className="font-mono text-sm">{formatPercent(neuron.trust * 100)}</TableCell>
              <TableCell className="font-mono text-sm">{formatPercent(neuron.consensus * 100)}</TableCell>
              <TableCell className="font-mono text-sm">#{neuron.rank}</TableCell>
              <TableCell className="font-mono text-sm">{formatTao(neuron.emission)}</TableCell>
              <TableCell>
                <Badge variant={neuron.status === 'active' ? 'success' : 'secondary'} className="capitalize">
                  {neuron.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// --- Mock Data Generators ---

function generateTimeSeries(baseValue: number, days: number): Array<{ timestamp: string; value: number }> {
  const data = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    // Add some realistic variance (±15%)
    const variance = (Math.random() - 0.5) * 0.3
    const value = Math.max(0, baseValue * (1 + variance))
    data.push({ timestamp: date.toISOString(), value })
  }
  return data
}

function generateMockNeurons() {
  const validators = 5
  const miners = Math.min(20, 32) // Limit for display
  const neurons = []

  // Validators first
  for (let i = 0; i < validators; i++) {
    const stake = 10000 + Math.random() * 50000
    neurons.push({
      uid: i,
      hotkey: `5${Math.random().toString(36).substring(2, 48)}`,
      type: 'validator' as const,
      stake,
      incentive: 0.01 + Math.random() * 0.05,
      trust: 0.7 + Math.random() * 0.3,
      consensus: 0.8 + Math.random() * 0.2,
      rank: i + 1,
      emission: stake * 0.001 * (1 + Math.random()),
      status: 'active' as const,
    })
  }

  // Miners
  for (let i = 0; i < miners; i++) {
    const stake = 100 + Math.random() * 5000
    neurons.push({
      uid: validators + i,
      hotkey: `5${Math.random().toString(36).substring(2, 48)}`,
      type: 'miner' as const,
      stake,
      incentive: Math.random() * 0.02,
      trust: 0.3 + Math.random() * 0.5,
      consensus: 0.4 + Math.random() * 0.4,
      rank: validators + i + 1,
      emission: stake * 0.001 * (0.5 + Math.random()),
      status: Math.random() > 0.1 ? 'active' : 'inactive',
    })
  }

  return neurons
}

function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return `${str.slice(0, length)}...`
}

function adaptOpportunityDetail(b: BackendOpportunityDetail): Opportunity {
  const score = Number(b.total_score ?? 0)
  const COMPONENT_LABELS: Record<string, string> = {
    economic_potential: 'Economic Potential',
    competition: 'Competition',
    reward_stability: 'Reward Stability',
    market_conditions: 'Market Conditions',
    new_miner_accessibility: 'New Miner Accessibility',
    network_health: 'Network Health',
    hardware_suitability: 'Hardware Suitability',
    profitability_potential: 'Profitability Potential',
  }

  function deriveRiskLevel(score: number): 'low' | 'medium' | 'high' {
    if (score >= 70) return 'low'
    if (score >= 45) return 'medium'
    return 'high'
  }

  function deriveFactors(components: BackendScoreComponent[]): OpportunityFactor[] {
    return (components ?? []).map((c) => ({
      name: COMPONENT_LABELS[c.name as string] ?? (c.name as string),
      value: c.weighted as number,
      weight: c.weight as number,
      impact: (c.score as number) >= 60 ? 'positive' : (c.score as number) <= 40 ? 'negative' : 'neutral',
      description: (c.explanation as string) ?? '',
    }))
  }

  return {
    id: String(b.netuid),
    subnet_id: String(b.netuid),
    subnet_name: b.subnet_name ?? `Subnet ${b.netuid}`,
    subnet_symbol: `α${b.netuid}`,
    netuid: b.netuid,
    type: 'mining' as const,
    score,
    rank: 0,
    estimated_daily_reward: 0,
    estimated_monthly_reward: 0,
    estimated_apy: 0,
    required_stake: 0,
    current_stake: 0,
    utilization: 0,
    risk_level: deriveRiskLevel(score),
    confidence: score / 100,
    factors: deriveFactors(b.components ?? []),
    status: 'active' as const,
    expires_at: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}