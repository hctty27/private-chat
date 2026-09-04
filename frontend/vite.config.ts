import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/node_modules/element-plus/') || id.includes('/node_modules/@element-plus/')) {
            return 'element-plus'
          }
          if (id.includes('/node_modules/@vue/') || id.includes('/node_modules/vue/') || id.includes('/node_modules/vue-router/') || id.includes('/node_modules/pinia/')) {
            return 'vue-vendor'
          }
          if (id.includes('/node_modules/axios/')) {
            return 'http-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
})
