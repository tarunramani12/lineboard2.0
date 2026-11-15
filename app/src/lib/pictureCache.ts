/**
 * The service worker (see vite.config.ts) keeps a copy of every picture the person has opened, so it is not downloaded again.
 * Pictures belong to the signed-in person, so the copies are removed on sign out and when an account is deleted.
 * The name must match `cacheName` in vite.config.ts.
 */
export const PICTURE_CACHE = 'lb-pictures-v1'

export async function clearPictureCache(): Promise<void> {
  try {
    if ('caches' in window) await caches.delete(PICTURE_CACHE)
  } catch { /* no cache support or storage blocked: nothing to clear */ }
}
