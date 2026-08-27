import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUserStore = defineStore('user', () => {
  const userId = ref(0)
  const nickname = ref('')
  const authenticated = ref(false)

  function login(id: number, name: string) {
    userId.value = id
    nickname.value = name
    authenticated.value = id > 0
  }

  function clearSession() {
    userId.value = 0
    nickname.value = ''
    authenticated.value = false
  }

  function logout() {
    if (typeof window !== 'undefined') {
      void fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
      }).catch(() => undefined)
    }

    clearSession()
  }

  const isLoggedIn = () => authenticated.value && userId.value > 0

  return {
    userId,
    nickname,
    authenticated,
    login,
    logout,
    clearSession,
    isLoggedIn,
  }
})
