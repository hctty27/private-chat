import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(process.cwd(), 'dist')
const assetsDir = resolve(distDir, 'assets')

const limits = {
  js: 120 * 1024,
  css: 80 * 1024,
}

function findAsset(extension) {
  return readdirSync(assetsDir)
    .filter((name) => name.startsWith('element-plus-') && name.endsWith(extension))
    .map((name) => ({
      name,
      size: statSync(resolve(assetsDir, name)).size,
    }))
    .sort((a, b) => b.size - a.size)[0]
}

function assertBudget(asset, limit, label) {
  if (!asset) {
    throw new Error(`Missing Element Plus ${label} chunk`)
  }
  if (asset.size > limit) {
    throw new Error(
      `Element Plus ${label} budget exceeded: ${asset.name} is ${asset.size} bytes, limit ${limit} bytes`,
    )
  }
}

const js = findAsset('.js')
const css = findAsset('.css')
assertBudget(js, limits.js, 'JS')
assertBudget(css, limits.css, 'CSS')

const html = readFileSync(resolve(distDir, 'index.html'), 'utf8')
if (html.includes('element-plus-')) {
  throw new Error('Element Plus must not be preloaded by the application entrypoint')
}

console.log(
  `Bundle budget OK: ${js.name}=${js.size} bytes, ${css.name}=${css.size} bytes`,
)
