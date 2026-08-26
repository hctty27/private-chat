import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElButton } from 'element-plus/es/components/button/index'
import { ElForm } from 'element-plus/es/components/form/index'
import { ElInput } from 'element-plus/es/components/input/index'
import 'element-plus/dist/index.css'
import router from './router'
import App from './App.vue'
import { installSessionRecovery } from './auth/sessionRecovery'
import './assets/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElButton)
app.use(ElForm)
app.use(ElInput)
installSessionRecovery()
app.mount('#app')
