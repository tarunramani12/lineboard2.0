import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  recovering: boolean
}
const AuthContext = createContext<AuthState>({ user: null, session: null, loading: true, recovering: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, session: null, loading: true, recovering: false })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState((s) => ({ ...s, session: data.session, user: data.session?.user ?? null, loading: false }))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setState((s) => ({
        session, user: session?.user ?? null, loading: false,
        recovering: event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' ? false : s.recovering,
      }))
      // After sign-in, turn any invites sent to this email into memberships.
      if (event === 'SIGNED_IN' && session) {
        setTimeout(() => { void supabase.rpc('accept_pending_invites') }, 0)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use at least one letter and one number.'
  return null
}
