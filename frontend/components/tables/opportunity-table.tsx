'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, Filter, MoreHorizontal } from 'lucide-react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { formatNumber, formatCurrency, formatPercent, getStatusColor } from '@/lib/utils'
import type { Opportunity, TableColumn } from '@/types'

interface OpportunityTableProps {
  opportunities: Opportunity[]
  sortable?: boolean
  onRowClick?: (opportunity: Opportunity) => void
  className?: string
}

const columns: TableColumn<Opportunity>[] = [
  {
    key: 'subnet_name',
    header: 'Subnet',
    sortable: true,
    render: (row) => (
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium truncate max-w-[200px]">
            {row.subnet_name ?? `Subnet ${row.netuid}`}
          </span>
          <Badge variant="outline" className="text-xs">
            {row.subnet_symbol ?? `α${row.netuid}`}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">NetUID: {row.netuid}</p>
      </div>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    sortable: true,
    render: (row) => (
      <Badge variant="outline" className="capitalize">{row.type}</Badge>
    ),
  },
  {
    key: 'score',
    header: 'Score',
    sortable: true,
    render: (row) => (
      <span className="font-medium tabular-nums">
        {(Number(row.score) || 0).toFixed(1)}
      </span>
    ),
  },
  {
    key: 'estimated_apy',
    header: 'Est. APY',
    sortable: true,
    render: (row) => (
      <span className="font-medium tabular-nums text-success">
        {formatPercent(Number(row.estimated_apy) || 0)}
      </span>
    ),
  },
  {
    key: 'estimated_monthly_reward',
    header: 'Monthly Reward',
    sortable: true,
    render: (row) => (
      <span className="font-medium tabular-nums">
        {formatCurrency(Number(row.estimated_monthly_reward) || 0)}
      </span>
    ),
  },
  {
    key: 'required_stake',
    header: 'Required Stake',
    sortable: true,
    render: (row) => (
      <span className="font-mono tabular-nums">
        {formatNumber(Number(row.required_stake) || 0)} TAO
      </span>
    ),
  },
  {
    key: 'utilization',
    header: 'Utilization',
    sortable: true,
    render: (row) => (
      <span className="font-medium tabular-nums">
        {formatPercent((Number(row.utilization) || 0) * 100)}
      </span>
    ),
  },
  {
    key: 'risk_level',
    header: 'Risk',
    sortable: true,
    render: (row) => {
      const color = getStatusColor(String(row.risk_level ?? 'inactive'))
      return (
        <Badge variant="outline" className={cn('capitalize', color.bg, color.text)}>
          {row.risk_level ?? 'unknown'}
        </Badge>
      )
    },
  },
  {
    key: 'confidence',
    header: 'Confidence',
    sortable: true,
    render: (row) => (
      <span className="font-medium tabular-nums text-success">
        {formatPercent((Number(row.confidence) || 0) * 100)}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortable: true,
    render: (row) => {
      const color = getStatusColor(String(row.status ?? 'inactive'))
      return (
        <Badge variant="outline" className={cn('capitalize', color.bg, color.text)}>
          {row.status ?? 'unknown'}
        </Badge>
      )
    },
  },
  {
    key: 'actions',
    header: '',
    render: (row) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={`/opportunities/${row.id}`} className="flex items-center gap-2">
              View Details
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/subnets/${row.subnet_id}`} className="flex items-center gap-2">
              Analyze Subnet
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]

export function OpportunityTable({
  opportunities,
  sortable = true,
  onRowClick,
  className,
}: OpportunityTableProps) {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null)
  const [search, setSearch] = useState('')
  const [filters] = useState<Partial<Record<string, string>>>({})

  const filteredOpportunities = useMemo(() => {
    let result = opportunities

    if (search) {
      const searchLower = search.toLowerCase()
      result = result.filter(
        (opp) =>
          opp.subnet_name.toLowerCase().includes(searchLower) ||
          opp.subnet_symbol.toLowerCase().includes(searchLower) ||
          opp.type.toLowerCase().includes(searchLower)
      )
    }

    Object.entries(filters).forEach(([key, value]) => {
      if (value) {
        result = result.filter((opp) => String(opp[key as keyof Opportunity]).toLowerCase().includes(value.toLowerCase()))
      }
    })

    if (sortConfig && sortable) {
      result = [...result].sort((a, b) => {
        const aVal = a[sortConfig.key as keyof Opportunity]
        const bVal = b[sortConfig.key as keyof Opportunity]
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
        return 0
      })
    }

    return result
  }, [opportunities, search, filters, sortConfig, sortable])

  const handleSort = (key: string) => {
    if (!sortable) return
    setSortConfig((prev) => ({
      key,
      direction: prev?.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig?.key !== key) return <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
    return sortConfig.direction === 'asc' ? (
      <ChevronUp className="h-4 w-4" />
    ) : (
      <ChevronDown className="h-4 w-4" />
    )
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search opportunities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
            aria-label="Search opportunities"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="hidden sm:flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </Button>
        </div>
      </div>

      <div className="table-container">
        <Table>
          <TableCaption className="p-4">
            {filteredOpportunities.length} of {opportunities.length} opportunities
          </TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} className="cursor-pointer select-none">
                  <div className="flex items-center gap-1">
                    {column.header}
                    {column.sortable && sortable && (
                      <button
                        onClick={() => handleSort(column.key)}
                        className="p-1 hover:text-foreground transition-colors"
                        aria-label={`Sort by ${column.header}`}
                      >
                        <SortIcon columnKey={column.key} key={column.key} />
                      </button>
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOpportunities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-12">
                  <p className="text-muted-foreground">No opportunities found</p>
                </TableCell>
              </TableRow>
            ) : (
              filteredOpportunities.map((opportunity) => (
                <TableRow
                  key={opportunity.id}
                  onClick={() => onRowClick?.(opportunity)}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key}>
                      {column.render?.(opportunity) ?? String(opportunity[column.key as keyof Opportunity] ?? '')}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}