import { useCallback, useSyncExternalStore } from 'react'

/**
 * Install help. Chrome and Edge on Android and desktop offer an install prompt that the page can trigger from its own button.
 * iPhone and iPad (Safari) never do: the person has to use Share, then Add to Home Screen, so a short hint is shown instead.
 * Nothing is shown once the app is installed (opened from the home screen), and "Not now" hides the hint for 30 days on this device.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const SNOOZE_KEY = 'lb-install-snooze-until'
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

export function isIosDevice(ua: string, platform: string, touchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)   // iPadOS reports itself as a Mac
}

export function isSnoozed(stored: string | null, now = Date.now()): boolean {
  const until = Number(stored)
  return Number.isFinite(until) && until > now
}

export type InstallKind = 'prompt' | 'ios' | null

/** What to show: the install button, the iPhone hint, or nothing. */
export function installKind(o: { standalone: boolean; snoozed: boolean; hasPrompt: boolean; ios: boolean }): InstallKind {
  if (o.standalone || o.snoozed) return null
  if (o.hasPrompt) return 'prompt'
  return o.ios ? 'ios' : null
}

// ---- browser state, kept outside React so the early 'beforeinstallprompt' event is not missed
let deferred: InstallPromptEvent | null = null
let installed = false
let snoozeNow = false
let snapshot = ''
const listeners = new Set<() => void>()
const emit = () => { snapshot = ''; listeners.forEach((l) => l()) }

const readSnooze = (): boolean => { try { return isSnoozed(localStorage.getItem(SNOOZE_KEY)) } catch { return false } }
const standaloneNow = (): boolean =>
  installed || window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Call once at start-up (main.tsx). */
export function initInstall(): void {
  snoozeNow = readSnooze()
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallPromptEvent; emit() })
  window.addEventListener('appinstalled', () => { installed = true; deferred = null; emit() })
}

function getSnapshot(): string {
  if (!snapshot) {
    snapshot = installKind({
      standalone: standaloneNow(), snoozed: snoozeNow, hasPrompt: deferred !== null,
      ios: isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    }) ?? 'none'
  }
  return snapshot
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export function useInstallHint() {
  const kind = useSyncExternalStore(subscribe, getSnapshot, () => 'none')
  const install = useCallback(async () => {
    if (!deferred) return
    const ev = deferred
    deferred = null   // a prompt can be used once
    await ev.prompt()
    await ev.userChoice.catch(() => undefined)
    emit()
  }, [])
  const dismiss = useCallback(() => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)) } catch { /* storage blocked: hidden until the page is reloaded */ }
    snoozeNow = true
    emit()
  }, [])
  return { kind: (kind === 'none' ? null : kind) as InstallKind, install, dismiss }
}
