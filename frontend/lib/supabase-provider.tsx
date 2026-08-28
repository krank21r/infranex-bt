'use client'

import { SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

const SupabaseContext = createContext<SupabaseClient | null>(null)

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null)

  useEffect(() => {
    // Dynamic import to avoid SSR issues
    import('@supabase/ssr').then(({ createBrowserClient }) => {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      setClient(supabase)
    })
  }, [])

  return (
    <SupabaseContext.Provider value={client}>
      {children}
    </SupabaseContext.Provider>
  )
}

export function useSupabaseClient() {
  const context = useContext(SupabaseContext)
  if (!context) {
    throw new Error('useSupabaseClient must be used within a SupabaseProvider')
  }
  return context
}