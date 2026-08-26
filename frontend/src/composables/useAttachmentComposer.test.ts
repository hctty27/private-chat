import { describe, expect, it, vi } from 'vitest'
import { useAttachmentComposer } from './useAttachmentComposer'

describe('useAttachmentComposer', () => {
  it('stages multiple files with an immutable recipient snapshot', () => {
    const current = { id: 1, nickname: 'Alice' }
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: vi.fn(),
    })
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]

    composer.stage(files, current)
    files.pop()
    current.nickname = 'Changed'

    expect(composer.staged.value?.files).toHaveLength(2)
    expect(composer.staged.value?.files[0]?.name).toBe('a.png')
    expect(composer.staged.value?.files[1]?.name).toBe('b.jpg')
    expect(composer.staged.value?.recipient).toEqual({ id: 1, nickname: 'Alice' })
  })

  it('returns the files once when the recipient still matches', () => {
    const current = { id: 1, nickname: 'Alice' }
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: vi.fn(),
    })
    const files = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]
    composer.stage(files, current)

    expect(composer.takeConfirmed()).toEqual(files)
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
    composer.stage([new File(['x'], 'a.png')], current)
    current = { id: 2, nickname: 'Bob' }

    expect(composer.takeConfirmed()).toBeNull()
    expect(composer.staged.value).toBeNull()
    expect(mismatch).toHaveBeenCalledOnce()
  })

  it('cancels without returning files', () => {
    const current = { id: 1, nickname: 'Alice' }
    const composer = useAttachmentComposer({
      getCurrentRecipient: () => current,
      onRecipientMismatch: vi.fn(),
    })
    composer.stage([new File(['x'], 'a.png')], current)

    composer.cancel()

    expect(composer.staged.value).toBeNull()
    expect(composer.takeConfirmed()).toBeNull()
  })
})
