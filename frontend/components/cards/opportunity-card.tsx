'use client'

import { cn } from '@/lib/utils'
import { formatNumber, formatCurrency, formatPercent, getStatusColor } from '@/lib/utils'
import { TrendingUp, AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { Opportunity } from '@/types'

interface OpportunityCardProps {
  opportunity: Opportunity
  compact?: boolean
}

export function OpportunityCard({ opportunity, compact = false }: OpportunityCardProps) {
  const statusColor = getStatusColor(opportunity.status)
  const riskColor = getStatusColor(opportunity.risk_level)

  if (compact) {
    return (
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-lg truncate">{opportunity.subnet_name}</CardTitle>
                <Badge variant="outline" className="text-xs">
                  {opportunity.subnet_symbol}
                </Badge>
                <Badge
                  variant={opportunity.status === 'active' ? 'success' : 'secondary'}
                  className="text-xs"
                >
                  {opportunity.status}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                NetUID: {opportunity.netuid} • {opportunity.type}
              </p>
              <div className="mt-2 flex items-center gap-4 text-sm">
                <span className="flex items-center gap-1 font-medium">
                  <TrendingUp className="h-3 w-3 text-success" />
                  {formatPercent(opportunity.estimated_apy)} APY
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className={cn('h-3 w-3', riskColor.text)} />
                  <span className={cn('font-medium capitalize', riskColor.text)}>
                    {opportunity.risk_level} risk
                  </span>
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-lg font-bold tabular-nums">
                {formatCurrency(opportunity.estimated_monthly_reward)}/mo
              </p>
              <p className="text-xs text-muted-foreground">
                {formatCurrency(opportunity.estimated_daily_reward)}/day
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-xl">{opportunity.subnet_name}</CardTitle>
              <Badge variant="outline">{opportunity.subnet_symbol}</Badge>
              <Badge variant={opportunity.status === 'active' ? 'success' : 'secondary'}>
                {opportunity.status}
              </Badge>
              <Badge variant={opportunity.type === 'mining' ? 'default' : 'secondary'}>
                {opportunity.type}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              NetUID: {opportunity.netuid} • Rank #{opportunity.rank} • Score: {opportunity.score.toFixed(1)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums">
              {formatCurrency(opportunity.estimated_monthly_reward)}
            </p>
            <p className="text-sm text-muted-foreground">Est. Monthly Reward</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pb-3">
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Daily Reward</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatCurrency(opportunity.estimated_daily_reward)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">APY</p>
            <p className="text-lg font-semibold tabular-nums text-success">
              {formatPercent(opportunity.estimated_apy)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Required Stake</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatNumber(opportunity.required_stake)} TAO
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Utilization</p>
            <div className="flex items-center gap-2">
              <Progress
                value={opportunity.utilization * 100}
                className="flex-1 h-2"
                max={100}
              />
              <span className="text-sm font-medium tabular-nums">
                {formatPercent(opportunity.utilization * 100)}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Risk:</span>
            <Badge variant="outline" className={cn('capitalize', riskColor.bg, riskColor.text)}>
              {opportunity.risk_level}
            </Badge>
            <span className="text-xs text-muted-foreground">Confidence:</span>
            <Badge variant="outline" className="text-success">
              {formatPercent(opportunity.confidence * 100)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <a href={`/opportunities/${opportunity.id}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3 mr-1" />
                Details
              </a>
            </Button>
          </div>
        </div>

        {opportunity.factors.length > 0 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">Key Factors</p>
            <div className="flex flex-wrap gap-2">
              {opportunity.factors.slice(0, 4).map((factor) => (
                <Badge
                  key={factor.name}
                  variant={
                    factor.impact === 'positive' ? 'success' :
                    factor.impact === 'negative' ? 'destructive' : 'outline'
                  }
                  className="text-xs"
                >
                  {factor.name} ({factor.impact === 'positive' ? '+' : ''}{factor.value.toFixed(1)})
                </Badge>
              ))}
              {opportunity.factors.length > 4 && (
                <Badge variant="outline" className="text-xs">
                  +{opportunity.factors.length - 4} more
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="pt-0">
        <div className="flex items-center justify-between w-full">
          <Button variant="outline" className="flex-1" asChild>
            <a href={`/opportunities/${opportunity.id}`}>
              View Details
            </a>
          </Button>
          <Button className="flex-1 ml-2" asChild>
            <a href={`/subnets/${opportunity.subnet_id}`}>
              Analyze Subnet
            </a>
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}