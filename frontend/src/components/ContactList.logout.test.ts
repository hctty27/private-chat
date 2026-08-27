import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/components/ContactList.vue'), 'utf8')

describe('contact list logout confirmation', () => {
  it('uses the application message box instead of browser confirm', () => {
    expect(source).toContain("import { ElMessageBox } from 'element-plus'")
    expect(source).toContain('ElMessageBox.confirm(')
    expect(source).toContain("confirmButtonText: '退出'")
    expect(source).toContain("cancelButtonText: '取消'")
    expect(source).toContain("customClass: 'logout-confirm-box'")
    expect(source).not.toMatch(/\b(?:window\.)?confirm\s*\(/)
  })
})
