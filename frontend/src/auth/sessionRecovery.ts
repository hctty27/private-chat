import { checkSession } from '../api'
import { useUserStore } from '../stores/user'

const CHECK_INTERVAL_MS = 60_000
let inFlightCheck: Promise<void> | null = null
let cleanupRecovery: (() => void) | null = null

export function verifyCurrentSession(): Promise<void> {
  if (!useUserStore().token) return Promise.resolve()
  if (inFlightCheck) return inFlightCheck

  inFlightCheck = checkSession()
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      inFlightCheck = null
    })

  return inFlightCheck
}

export function installSessionRecovery() {
  if (cleanupRecovery || typeof window === 'undefined') return cleanupRecovery || undefined

  const verifyWhenVisible = () => {
    if (document.visibilityState === 'visible') void verifyCurrentSession()
  }
  const intervalId = window.setInterval(verifyWhenVisible, CHECK_INTERVAL_MS)

  document.addEventListener('visibilitychange', verifyWhenVisible)
  window.addEventListener('pageshow', verifyWhenVisible)
  window.addEventListener('online', verifyWhenVisible)

  cleanupRecovery = () => {
    document.removeEventListener('visibilitychange', verifyWhenVisible)
    window.removeEventListener('pageshow', verifyWhenVisible)
    window.removeEventListener('online', verifyWhenVisible)
    window.clearInterval(intervalId)
    cleanupRecovery = null
  }

  void verifyCurrentSession()
  return cleanupRecovery
}
