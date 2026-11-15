import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { defaultShouldDehydrateQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { del, get, set } from 'idb-keyval'

/**
 * Read-only offline copy of what the person has already opened.
 * Every successful read the app makes is saved on this device (IndexedDB) and shown again when there is no signal.
 * Editing still needs a connection. The copy belongs to the signed-in person: it is deleted on sign out, when the session
 * ends, and when someone else signs in on the same device.
 */

export const OFFLINE_KEY = 'lb-offline-cache'
const OWNER_KEY = 'lb-offline-owner'
/** How long a saved copy is kept without a visit. */
export const MAX_AGE = 7 * 24 * 60 * 60 * 1000

/** A new build never reads a copy saved by an older one, so a changed data shape cannot break the screens. */
export const BUSTER = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

/** Reads that are never saved: the owner's dashboard (other people's emails), the email queue, and the create-project check. */
const NEVER_SAVED = new Set(['usage-overview', 'usage-projects', 'usage-people', 'outbox', 'can-create-project'])

export function shouldSave(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  return typeof head !== 'string' || !NEVER_SAVED.has(head)
}

// IndexedDB can be missing or blocked (private windows); then nothing is saved and the app works as before.
const storage = {
  getItem: async (k: string) => { try { return ((await get(k)) as string | undefined) ?? null } catch { return null } },
  setItem: async (k: string, v: string) => { try { await set(k, v) } catch { /* not saved */ } },
  removeItem: async (k: string) => { try { await del(k) } catch { /* nothing to remove */ } },
}

export const persister = createAsyncStoragePersister({ storage, key: OFFLINE_KEY, throttleTime: 2000 })

export const persistOptions = {
  persister,
  maxAge: MAX_AGE,
  buster: BUSTER,
  dehydrateOptions: {
    shouldDehydrateQuery: (q: Parameters<typeof defaultShouldDehydrateQuery>[0]) => defaultShouldDehydrateQuery(q) && shouldSave(q.queryKey),
  },
}

/** Remove the saved copy (sign out, session ended, different person). */
export async function clearOfflineData(): Promise<void> {
  await storage.removeItem(OFFLINE_KEY)
  await storage.removeItem(OWNER_KEY)
}

/** Remember who the saved copy belongs to. Returns true when it belonged to someone else and was removed. */
export async function claimOfflineData(userId: string): Promise<boolean> {
  const owner = await storage.getItem(OWNER_KEY)
  if (owner === userId) return false
  if (owner !== null) await storage.removeItem(OFFLINE_KEY)
  await storage.setItem(OWNER_KEY, userId)
  return owner !== null
}

/**
 * The session the sign-in library keeps in the browser. Its access token lasts about an hour; with no signal the library cannot
 * renew it and reports "signed out", which would lock the person out of their saved copy. Offline, this stored session is used
 * to keep them in. It is only read here, never used to talk to the server.
 */
export function parseStoredSession(raw: string | null): Session | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Partial<Session> | null
    if (s && typeof s.refresh_token === 'string' && s.user && typeof s.user.id === 'string') return s as Session
  } catch { /* not a session */ }
  return null
}

export function storedSession(): Session | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && /^sb-.+-auth-token$/.test(k)) return parseStoredSession(localStorage.getItem(k))
    }
  } catch { /* storage blocked */ }
  return null
}
