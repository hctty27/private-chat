import { checkSession } from '../api'
import { useUserStore } from '../stores/user'

const CHECK_INTERVAL_MS = 60_000
let inFlightCheck: Promise<void> | null = null
let installed = false

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
  if (installed || typeof window === 'undefined') return
  installed = true

  const verifyWhenVisible = () => {
    if (document.visibilityState === 'visible') void verifyCurrentSession()
  }

  document.addEventListener('visibilitychange', verifyWhenVisible)
  window.addEventListener('pageshow', verifyWhenVisible)
  window.addEventListener('online', verifyWhenVisible)
  window.setInterval(verifyWhenVisible, CHECK_INTERVAL_MS)
  void verifyCurrentSession()
}
