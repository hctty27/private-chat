import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
}
const packageLock = JSON.parse(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8')) as {
  packages: Record<string, {
    version?: string
    dependencies?: Record<string, string>
  }>
}

describe('TanStack Virtual iOS fixes', () => {
  it('uses the Vue adapter release that includes virtual-core 3.17.7', () => {
    const vueVirtual = packageLock.packages['node_modules/@tanstack/vue-virtual']

    expect(packageJson.dependencies['@tanstack/vue-virtual']).toBe('3.13.35')
    expect(vueVirtual?.version).toBe('3.13.35')
    expect(vueVirtual?.dependencies?.['@tanstack/virtual-core']).toBe('3.17.7')
    expect(packageLock.packages['node_modules/@tanstack/virtual-core']?.version).toBe('3.17.7')
  })
})