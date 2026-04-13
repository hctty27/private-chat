<template>
  <div class="min-h-screen bg-gradient-to-br from-orange-100 to-pink-100 flex items-center justify-center p-4">
    <div class="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8">
      <div class="text-center mb-8">
        <h1 class="text-2xl font-bold text-gray-800">登录</h1>
        <p class="mt-2 text-sm text-gray-500">欢迎回来，请登录您的账号</p>
      </div>

      <el-form @submit.prevent="handleLogin" class="space-y-5">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">用户名</label>
          <el-input
            v-model="username"
            placeholder="请输入用户名"
            size="large"
            clearable
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">密码</label>
          <el-input
            v-model="password"
            type="password"
            placeholder="请输入密码"
            size="large"
            show-password
            @keyup.enter="handleLogin"
          />
        </div>
        <el-button
          type="primary"
          size="large"
          class="w-full"
          :loading="loading"
          @click="handleLogin"
          style="width: 100%; background: linear-gradient(135deg, #f97316, #ec4899); border: none;"
        >
          登录
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { login as loginApi } from '../api'
import { useUserStore } from '../stores/user'

const router = useRouter()
const userStore = useUserStore()

const username = ref('')
const password = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!username.value.trim() || !password.value.trim()) {
    ElMessage.warning('请输入用户名和密码')
    return
  }

  loading.value = true
  try {
    const res = await loginApi(username.value.trim(), password.value)
    if (res.data.code === 200) {
      const { token, userId, nickname } = res.data.data
      userStore.login(token, userId, nickname)
      sessionStorage.removeItem('fromCover')
      router.push('/chat')
    } else {
      ElMessage.error(res.data.message || '登录失败')
    }
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '登录失败，请重试')
  } finally {
    loading.value = false
  }
}
</script>
