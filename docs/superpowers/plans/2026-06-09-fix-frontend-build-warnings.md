# Fix Frontend Build Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the frontend Docker build warnings by updating vulnerable dependency resolutions and splitting oversized Vite production chunks.

**Architecture:** Keep the application behavior unchanged. Use npm's audit metadata to update only vulnerable package resolutions already allowed by existing semver ranges, then configure Vite/Rollup chunk splitting in the existing Vite config.

**Tech Stack:** Vue 3, Vite 6, Rollup manualChunks, npm package-lock v3, Docker Compose.

---

## File Structure

- Modify: `frontend/package-lock.json`
  - Responsibility: lock safe transitive/direct dependency versions for `axios`, `follow-redirects`, and `postcss`.
- Modify: `frontend/vite.config.ts`
  - Responsibility: keep existing Vue/Tailwind plugins and dev proxy, add production build chunk splitting.

---

### Task 1: Update vulnerable frontend dependency resolutions

**Files:**
- Modify: `frontend/package-lock.json`

- [ ] **Step 1: Verify the failing audit check**

Run:

```bash
npm --prefix /home/project/private-chat/frontend audit --json
```

Expected before the fix: command exits non-zero and reports vulnerabilities for `axios`, `follow-redirects`, and `postcss`.

- [ ] **Step 2: Apply npm's minimal audit fix**

Run:

```bash
npm --prefix /home/project/private-chat/frontend audit fix
```

Expected: npm updates `frontend/package-lock.json` and local `node_modules` without requiring `--force`.

- [ ] **Step 3: Verify the audit check passes**

Run:

```bash
npm --prefix /home/project/private-chat/frontend audit --json
```

Expected after the fix: command exits zero and reports `metadata.vulnerabilities.total` as `0`.

---

### Task 2: Split oversized Vite production chunks

**Files:**
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: Verify the failing chunk warning check**

Run:

```bash
set -o pipefail
npm --prefix /home/project/private-chat/frontend run build:prod 2>&1 | tee /tmp/private-chat-vite-build.log
! grep -q "Some chunks are larger than 500 kB" /tmp/private-chat-vite-build.log
```

Expected before the fix: the final grep check exits non-zero because Vite prints the chunk size warning.

- [ ] **Step 2: Configure manual chunks**

Update `/home/project/private-chat/frontend/vite.config.ts` to:

```ts
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
          if (id.includes('/node_modules/@tanstack/')) {
            return 'tanstack-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
})
```

- [ ] **Step 3: Verify the chunk warning check passes**

Run:

```bash
set -o pipefail
npm --prefix /home/project/private-chat/frontend run build:prod 2>&1 | tee /tmp/private-chat-vite-build.log
! grep -q "Some chunks are larger than 500 kB" /tmp/private-chat-vite-build.log
```

Expected after the fix: command exits zero and no `Some chunks are larger than 500 kB` warning is printed.

---

### Task 3: Verify Docker Compose build

**Files:**
- No source files changed in this task.

- [ ] **Step 1: Rebuild Docker Compose images**

Run:

```bash
docker compose build --no-cache
```

Expected: `private-chat-frontend` and `private-chat-backend` both build successfully. The frontend build should not print npm audit vulnerability summary or Vite oversized chunk warning.

- [ ] **Step 2: Review changed files**

Run:

```bash
git -C /home/project/private-chat diff -- frontend/package-lock.json frontend/vite.config.ts
```

Expected: diff only contains dependency lock updates and Vite manual chunk configuration.
