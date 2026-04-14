import { createRouter, createWebHistory } from 'vue-router'

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
        if (sessionStorage.getItem('fromCover') !== 'true') {
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
      beforeEnter: (_to, _from, next) => {
        if (!localStorage.getItem('token')) { next('/'); return }
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
      beforeEnter: (_to, _from, next) => {
        if (!localStorage.getItem('token')) { next('/'); return }
        next()
      },
    },
  ],
})

export default router
