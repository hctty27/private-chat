import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const userStoreSource = readFileSync(resolve(process.cwd(), 'src/stores/user.ts'), 'utf8')
const apiSource = readFileSync(resolve(process.cwd(), 'src/api/index.ts'), 'utf8')
const routerSource = readFileSync(resolve(process.cwd(), 'src/router/index.ts'), 'utf8')
const loginSource = readFileSync(resolve(process.cwd(), 'src/views/LoginPage.vue'), 'utf8')

describe('cookie-only browser session', () => {
  it('never persists or attaches a browser-readable jwt', () => {
    for (const source of [userStoreSource, apiSource, routerSource, loginSource]) {
      expect(source).not.toContain("localStorage.getItem('token')")
      expect(source).not.toContain("localStorage.setItem('token'")
      expect(source).not.toContain('Authorization: `Bearer')
    }
    expect(apiSource).toContain('withCredentials: true')
  })

  it('restores protected routes from the server session endpoint', () => {
    expect(routerSource).toContain("import { checkSession } from '../api'")
    expect(routerSource).toContain('await restoreServerSession()')
    expect(routerSource).not.toContain("localStorage.getItem('token')")
  })

  it('hydrates login state from identity fields only', () => {
    expect(loginSource).toContain('const { userId, nickname } = res.data.data')
    expect(loginSource).toContain('userStore.login(userId, nickname)')
    expect(loginSource).not.toContain('const { token, userId, nickname }')
  })
})
