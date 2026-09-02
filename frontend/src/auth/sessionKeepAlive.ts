import { keepSessionAlive } from '../api'
import { useUserStore } from '../stores/user'

const keepAliveThrottleMs = 15 * 60 * 1000
const activityEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

let lastAttemptAt = 0
let inFlight = false

async function renewFromActivity() {
  const userStore = useUserStore()
  if (!userStore.isLoggedIn()) return

  const now = Date.now()
  if (inFlight || now - lastAttemptAt < keepAliveThrottleMs) return

  lastAttemptAt = now
  inFlight = true
  try {
    await keepSessionAlive()
  } catch {
    // 401 is handled by the shared API interceptor. Transient network errors retry on later activity.
  } finally {
    inFlight = false
  }
}

function onActivity() {
  void renewFromActivity()
}

export function installSessionKeepAlive() {
  for (const eventName of activityEvents) {
    window.addEventListener(eventName, onActivity, { passive: true })
  }

  return () => {
    for (const eventName of activityEvents) {
      window.removeEventListener(eventName, onActivity)
    }
  }
}

export function resetSessionKeepAliveForTests() {
  lastAttemptAt = 0
  inFlight = false
}
