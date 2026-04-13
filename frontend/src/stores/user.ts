import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUserStore = defineStore('user', () => {
  const token = ref(localStorage.getItem('token') || '')
  const userId = ref(Number(localStorage.getItem('userId')) || 0)
  const nickname = ref(localStorage.getItem('nickname') || '')

  function login(t: string, id: number, name: string) {
    token.value = t
    userId.value = id
    nickname.value = name
    localStorage.setItem('token', t)
    localStorage.setItem('userId', String(id))
    localStorage.setItem('nickname', name)
  }

  function logout() {
    token.value = ''
    userId.value = 0
    nickname.value = ''
    localStorage.removeItem('token')
    localStorage.removeItem('userId')
    localStorage.removeItem('nickname')
  }

  const isLoggedIn = () => !!token.value

  return { token, userId, nickname, login, logout, isLoggedIn }
})
