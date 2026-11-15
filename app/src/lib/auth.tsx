import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { claimOfflineData, clearOfflineData, storedSession } from './offline'
import { clearPictureCache } from './pictureCache'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
  recovering: boolean
}
const AuthContext = createContext<AuthState>({ user: null, session: null, loading: true, recovering: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, session: null, loading: true, recovering: false })
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      // With no signal the sign-in library cannot renew an expired token and answers "no session". The person is not signed out:
      // keep them in with the stored session so the offline copy of their projects stays readable (see lib/offline.ts).
      const session = data.session ?? (navigator.onLine ? null : storedSession())
      setState((s) => ({ ...s, session, user: session?.user ?? null, loading: false }))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session && event !== 'SIGNED_OUT' && !navigator.onLine) return   // not a real sign out: no signal, token could not be renewed
      if (event === 'SIGNED_OUT') { void clearOfflineData(); void clearPictureCache() }   // the saved copy belongs to the person who just left
      if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
        void claimOfflineData(session.user.id).then((someoneElses) => { if (someoneElses) qc.clear() })
      }
      setState((s) => ({
        session, user: session?.user ?? null, loading: false,
        recovering: event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' ? false : s.recovering,
      }))
      // After sign-in, turn any invites sent to this email into memberships.
      if (event === 'SIGNED_IN' && session) {
        setTimeout(() => { void supabase.rpc('accept_pending_invites'); void applyProviderName(session.user) }, 0)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

/**
 * Google and Apple send the person's name in the sign-in. The database gives a new profile the start of the email
 * address as its name; when that is still what the profile holds, replace it with the real name once.
 */
async function applyProviderName(user: User) {
  try {
    const meta = user.user_metadata as { full_name?: string; name?: string } | undefined
    const real = (meta?.full_name || meta?.name || '').trim()
    if (!real || !user.email) return
    const { data } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
    if (data && data.display_name === user.email.split('@')[0]) {
      await supabase.from('profiles').update({ display_name: real }).eq('id', user.id)
    }
  } catch { /* the name can still be set in Account settings */ }
}

/** True when this account can sign in with an email and password (a Google or Apple only account cannot). */
export function hasPasswordLogin(user: User | null): boolean {
  return Boolean(user?.identities?.some((i) => i.provider === 'email'))
}

export async function signInWithProvider(provider: 'google' | 'apple') {
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + '/' } })
  return error
}

export const useAuth = () => useContext(AuthContext)

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.'
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Use at least one letter and one number.'
  return null
}
