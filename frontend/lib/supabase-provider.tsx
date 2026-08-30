'use client'

import { SupabaseClient } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'

const SupabaseContext = createContext<SupabaseClient | null>(null)

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null)

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) return

    import('@supabase/ssr').then(({ createBrowserClient }) => {
      const supabase = createBrowserClient(url, key)
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
  return context
}