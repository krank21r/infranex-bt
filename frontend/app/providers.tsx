'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

interface AuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function getSupabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL
}

function getSupabaseAnonKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Tolerate Vercel Python cold starts on the monitoring/overview route
      // (first hit after quiet time can take 10-20s while the function
      // container warms up). React Query default retry is 3, but the default
      // retryDelay is exponential up to 30s — we cap it shorter so the user
      // sees a recovery within ~30s instead of waiting a full minute.
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnWindowFocus: false,
      // Don't stall the UI on a hung request forever — see AbortController
      // timeout added in lib/api.ts.
      staleTime: 1000 * 15,
    },
  },
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [supabase] = useState<ReturnType<typeof createBrowserClient> | null>(() => {
    const url = getSupabaseUrl()
    const key = getSupabaseAnonKey()
    return url && key ? createBrowserClient(url, key) : null
  })
  const [loading, setLoading] = useState(supabase !== null)

  useEffect(() => {
    if (!supabase) return
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }: { data: { session: Session | null } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: string, session: Session | null) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  const signOut = async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }

  const refreshSession = async () => {
    if (!supabase) return
    const { data: { session } } = await supabase.auth.getSession()
    setSession(session)
    setUser(session?.user ?? null)
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, session, loading, signOut, refreshSession }}>
        {children}
      </AuthContext.Provider>
    </QueryClientProvider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}