import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const nginxSource = readFileSync(resolve(process.cwd(), 'nginx.conf'), 'utf8')

describe('frontend nginx production policy', () => {
  it('keeps SPA HTML fresh while caching hashed assets immutably for a year', () => {
    expect(nginxSource).toMatch(/location = \/index\.html\s*\{[^}]*expires -1;/s)
    expect(nginxSource).toMatch(/location \/assets\/\s*\{[^}]*expires 1y;[^}]*Cache-Control "public, immutable";/s)
  })

  it('sends baseline browser security headers', () => {
    expect(nginxSource).toContain('X-Content-Type-Options "nosniff"')
    expect(nginxSource).toContain('Referrer-Policy "strict-origin-when-cross-origin"')
    expect(nginxSource).toContain('X-Frame-Options "DENY"')
    expect(nginxSource).toContain('Permissions-Policy "camera=(), microphone=(self), geolocation=()"')
  })

  it('allows the existing R2 media/upload and websocket paths without opening scripts', () => {
    expect(nginxSource).toContain("script-src 'self'")
    expect(nginxSource).toContain("img-src 'self' data: blob: https:")
    expect(nginxSource).toContain("media-src 'self' blob: https:")
    expect(nginxSource).toContain("connect-src 'self' https: ws: wss:")
    expect(nginxSource).toContain("object-src 'none'")
    expect(nginxSource).toContain("frame-ancestors 'none'")
  })
})
