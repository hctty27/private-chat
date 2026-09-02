import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(resolve(process.cwd(), 'src/main.ts'), 'utf8')

describe('session keep-alive bootstrap', () => {
  it('installs authenticated activity renewal globally', () => {
    expect(mainSource).toContain("import { installSessionKeepAlive } from './auth/sessionKeepAlive'")
    expect(mainSource).toContain('installSessionKeepAlive()')
  })
})
