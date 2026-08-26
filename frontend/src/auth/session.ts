import { useUserStore } from '../stores/user'

function setLoginNotice(message: string) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem('fromCover')
    window.sessionStorage.setItem('loginNotice', message)
  } catch {
    // Ignore storage errors; local auth state and redirect still take precedence.
  }
}

export function forceLogout(message = '登录已过期，请重新进入') {
  const userStore = useUserStore()
  userStore.clearSession()

  if (typeof window === 'undefined') return
  setLoginNotice(message)
  if (window.location.pathname !== '/') {
    window.location.replace('/')
  }
}
