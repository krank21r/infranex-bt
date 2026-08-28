'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  BarChart3,
  Network,
  Coins,
  TrendingUp,
  Settings,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Opportunities', href: '/opportunities', icon: TrendingUp },
  { name: 'Subnets', href: '/subnets', icon: Network },
  { name: 'Miners', href: '/miners', icon: Coins },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  return (
    <>
      <Button
        className="lg:hidden fixed top-4 left-4 z-50"
        onClick={() => setMobileOpen(true)}
        variant="ghost"
        size="icon"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen bg-card border-r transition-all duration-300 lg:relative',
          collapsed ? 'w-16' : 'w-64',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        aria-label="Sidebar"
      >
        <div className="flex h-full flex-col">
          <div className={cn('flex h-16 items-center justify-between px-4 border-b', collapsed && 'justify-center')}>
            {!collapsed && (
              <Link href="/" className="flex items-center gap-2 font-bold text-lg text-foreground">
                <Network className="h-6 w-6 text-primary" />
                <span>Infranex BT</span>
              </Link>
            )}
            <Button
              onClick={() => setCollapsed(!collapsed)}
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8', collapsed && 'rotate-180')}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <nav className="flex-1 space-y-1 p-4" aria-label="Main navigation">
              {navigation.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
                      collapsed && 'justify-center'
                    )}
                    aria-current={isActive ? 'page' : undefined}
                    title={collapsed ? item.name : undefined}
                  >
                    <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {!collapsed && <span>{item.name}</span>}
                  </Link>
                )
              })}
            </nav>
          </ScrollArea>

          <div className="border-t p-4">
            <Separator className="mb-4" />
            <div className={cn('flex items-center gap-3 px-3 py-2', collapsed && 'justify-center')}>
              <HelpCircle className="h-5 w-5 text-muted-foreground shrink-0" />
              {!collapsed && (
                <div className="text-xs text-muted-foreground">
                  <p className="font-medium">Need help?</p>
                  <p>Check our documentation</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  )
}