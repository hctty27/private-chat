import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcRoot = resolve(process.cwd(), 'src')

function productionSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) return productionSourceFiles(path)
    if (!/\.(ts|vue)$/.test(name) || name.endsWith('.test.ts')) return []
    return [path]
  })
}

describe('Element Plus bundle hygiene', () => {
  it('keeps production code on direct component imports and on-demand styles', () => {
    const violations: string[] = []

    for (const path of productionSourceFiles(srcRoot)) {
      const source = readFileSync(path, 'utf8')
      if (/from ['"]element-plus['"]/.test(source)) {
        violations.push(`${relative(srcRoot, path)}: barrel import`)
      }
      if (source.includes('element-plus/dist/index.css') || source.includes('element-plus/theme-chalk/index.css')) {
        violations.push(`${relative(srcRoot, path)}: full theme import`)
      }
    }

    expect(violations).toEqual([])
  })

  it('does not load Element Plus from the application entrypoint', () => {
    const mainSource = readFileSync(resolve(srcRoot, 'main.ts'), 'utf8')
    expect(mainSource).not.toContain('element-plus')
  })
})
