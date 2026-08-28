'use client'

import { useState } from 'react'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { cn } from '@/lib/utils'

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div
        className={cn(
          'transition-all duration-300 lg:pl-64',
          sidebarOpen ? 'lg:pl-16' : ''
        )}
      >
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="p-4 lg:p-6" role="main">
          {children}
        </main>
      </div>
    </div>
  )
}