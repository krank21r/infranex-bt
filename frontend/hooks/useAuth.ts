'use client'

import { useState, useEffect, useCallback } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { createBrowserClient } from '@supabase/ssr'
import { useSupabaseClient } from '@/lib/supabase-provider'
import type { User as AppUser, UserPreferences } from '@/types'

interface AuthState {
  user: AppUser | null
  session: Session | null
  loading: boolean
  error: Error | null
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    loading: true,
    error: null,
  })

  const supabase = useSupabaseClient()

  const fetchUser = useCallback(async () => {
    if (!supabase) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        setState({
          user: profile as AppUser,
          session,
          loading: false,
          error: null,
        })
      } else {
        setState({
          user: null,
          session: null,
          loading: false,
          error: null,
        })
      }
    } catch (error) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: error as Error,
      }))
    }
  }, [supabase])

  useEffect(() => {
    if (!supabase) return
    fetchUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
        
        setState({
          user: profile as AppUser,
          session,
          loading: false,
          error: null,
        })
      } else if (event === 'SIGNED_OUT') {
        setState({
          user: null,
          session: null,
          loading: false,
          error: null,
        })
      }
    })

    return () => subscription.unsubscribe()
  }, [supabase, fetchUser])

  const signIn = async (email: string, password: string) => {
    if (!supabase) throw new Error('Supabase client not available')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signUp = async (email: string, password: string, name: string) => {
    if (!supabase) throw new Error('Supabase client not available')
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    })
    if (error) throw error
    return data
  }

  const signOut = async () => {
    if (!supabase) throw new Error('Supabase client not available')
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  const updatePreferences = async (preferences: Partial<UserPreferences>) => {
    if (!supabase) throw new Error('Supabase client not available')
    if (!state.user) throw new Error('Not authenticated')
    
    const { error } = await supabase
      .from('profiles')
      .update({ preferences: { ...state.user.preferences, ...preferences } })
      .eq('id', state.user.id)

    if (error) throw error
    
    setState(prev => ({
      ...prev,
      user: prev.user ? { ...prev.user, preferences: { ...prev.user.preferences, ...preferences } } : null,
    }))
  }

  return {
    ...state,
    signIn,
    signUp,
    signOut,
    updatePreferences,
    refresh: fetchUser,
  }
}

export function useUser() {
  const { user, loading } = useAuth()
  return { user, loading }
}

export function useSession() {
  const { session, loading } = useAuth()
  return { session, loading }
}