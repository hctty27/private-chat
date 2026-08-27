import { createRouter, createWebHistory } from 'vue-router'
import { checkSession } from '../api'
import { useUserStore } from '../stores/user'

async function restoreServerSession() {
  const userStore = useUserStore()
  if (userStore.isLoggedIn()) return true

  try {
    const res = await checkSession()
    if (res.data.code !== 200) return false
    const { userId, nickname } = res.data.data
    userStore.login(userId, nickname)
    return true
  } catch {
    return false
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'cover',
      component: () => import('../views/CoverPage.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginPage.vue'),
      beforeEnter: (_to, _from, next) => {
        const enteredFromCover = sessionStorage.getItem('fromCover') === 'true'
        sessionStorage.removeItem('fromCover')

        if (!enteredFromCover) {
          next('/')
        } else {
          next()
        }
      },
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('../views/ChatPage.vue'),
      beforeEnter: async (_to, _from, next) => {
        if (!await restoreServerSession()) { next('/'); return }
        if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768) {
          next('/m/chat')
        } else {
          next()
        }
      },
    },
    {
      path: '/m/chat',
      name: 'mobile-chat',
      component: () => import('../views/MobileChat.vue'),
      beforeEnter: async (_to, _from, next) => {
        if (!await restoreServerSession()) { next('/'); return }
        next()
      },
    },
  ],
})

export default router
