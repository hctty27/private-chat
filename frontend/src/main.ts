import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { installSessionRecovery } from './auth/sessionRecovery'
import { installSessionKeepAlive } from './auth/sessionKeepAlive'
import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
installSessionRecovery()
installSessionKeepAlive()
app.mount('#app')
