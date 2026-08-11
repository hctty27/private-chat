import { describe, expect, it, vi } from 'vitest'
import { useAttachmentComposer } from './useAttachmentComposer'

describe('useAttachmentComposer', () => {
  it('stages a file with an immutable recipient snapshot', () => {
    const current = { id: 1, nickname: 'Alice' }
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: vi.fn(),
    })
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    composer.stage(file, current)
    current.nickname = 'Changed'

    expect(composer.staged.value?.file).toBe(file)
    expect(composer.staged.value?.recipient).toEqual({ id: 1, nickname: 'Alice' })
  })

  it('returns the file once when the recipient still matches', () => {
    const current = { id: 1, nickname: 'Alice' }
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: vi.fn(),
    })
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    composer.stage(file, current)

    expect(composer.takeConfirmed()).toBe(file)
    expect(composer.takeConfirmed()).toBeNull()
    expect(composer.staged.value).toBeNull()
  })

  it('blocks confirmation when the contact changed', () => {
    let current = { id: 1, nickname: 'Alice' }
    const mismatch = vi.fn()
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: mismatch,
    })
    composer.stage(new File(['x'], 'a.png'), current)
    current = { id: 2, nickname: 'Bob' }

    expect(composer.takeConfirmed()).toBeNull()
    expect(composer.staged.value).toBeNull()
    expect(mismatch).toHaveBeenCalledOnce()
  })

  it('cancels without returning a file', () => {
    const current = { id: 1, nickname: 'Alice' }
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: vi.fn(),
    })
    composer.stage(new File(['x'], 'a.png'), current)

    composer.cancel()

    expect(composer.staged.value).toBeNull()
    expect(composer.takeConfirmed()).toBeNull()
  })
})
