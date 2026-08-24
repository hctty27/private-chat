import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainCssSource = readFileSync(resolve(process.cwd(), 'src/assets/main.css'), 'utf8')

describe('MobileChat iOS viewport layout', () => {
  it('overrides the mobile document fixed-position lock', () => {
    expect(mainCssSource).toContain('position: static !important')
  })

  it('uses dynamic viewport sizing and horizontal safe-area padding', () => {
    expect(mainCssSource).toContain('100dvh')
    expect(mainCssSource).toContain('env(safe-area-inset-left)')
    expect(mainCssSource).toContain('env(safe-area-inset-right)')
  })
})
