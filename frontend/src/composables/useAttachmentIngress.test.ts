import { describe, expect, it, vi } from 'vitest'
import { useAttachmentIngress } from './useAttachmentIngress'

function makeFile(name = 'photo.png', size = 1024, type = 'image/png') {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  return file
}

function makePasteEvent(files: File[]) {
  const event = new Event('paste', { cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: { files },
  })
  return event
}

function makeDropEvent(files: File[]) {
  const event = new Event('drop', { cancelable: true }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: { files },
  })
  return event
}

function setup(recipient: { id: number; nickname: string } | null = { id: 7, nickname: 'Bob' }) {
  const onStage = vi.fn()
  const onWarning = vi.fn()
  const ingress = useAttachmentIngress({
    maxBytes: 50 * 1024 * 1024,
    maxFiles: 9,
    getRecipient: () => recipient,
    onStage,
    onWarning,
  })
  return { ingress, onStage, onWarning }
}

describe('useAttachmentIngress', () => {
  it('does not prevent text-only paste', () => {
    const { ingress, onStage } = setup()
    const event = makePasteEvent([])

    expect(ingress.handlePaste(event)).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(onStage).not.toHaveBeenCalled()
  })

  it('stages one pasted file and prevents default', () => {
    const { ingress, onStage } = setup()
    const file = makeFile()
    const event = makePasteEvent([file])

    expect(ingress.handlePaste(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(onStage).toHaveBeenCalledWith([file], { id: 7, nickname: 'Bob' })
  })

  it('stages multiple dropped images and prevents default navigation', () => {
    const { ingress, onStage } = setup()
    const files = [makeFile('a.png'), makeFile('b.jpg', 1024, 'image/jpeg')]
    const event = makeDropEvent(files)

    expect(ingress.handleDrop(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(onStage).toHaveBeenCalledWith(files, { id: 7, nickname: 'Bob' })
  })

  it('allows up to nine images in one batch', () => {
    const { ingress, onStage } = setup()
    const files = Array.from({ length: 9 }, (_, index) => makeFile(`${index}.png`))

    expect(ingress.acceptFiles(files)).toBe(true)
    expect(onStage).toHaveBeenCalledWith(files, { id: 7, nickname: 'Bob' })
  })

  it('rejects more than nine files with an explicit warning', () => {
    const { ingress, onStage, onWarning } = setup()
    const files = Array.from({ length: 10 }, (_, index) => makeFile(`${index}.png`))

    expect(ingress.acceptFiles(files)).toBe(false)
    expect(onWarning).toHaveBeenCalledWith('一次最多发送 9 张图片')
    expect(onStage).not.toHaveBeenCalled()
  })

  it('rejects a mixed batch that contains non-image files', () => {
    const { ingress, onStage, onWarning } = setup()
    const files = [makeFile('a.png'), makeFile('report.pdf', 1024, 'application/pdf')]

    expect(ingress.acceptFiles(files)).toBe(false)
    expect(onWarning).toHaveBeenCalledWith('批量发送仅支持图片')
    expect(onStage).not.toHaveBeenCalled()
  })

  it('still allows a single non-image attachment', () => {
    const { ingress, onStage } = setup()
    const file = makeFile('report.pdf', 1024, 'application/pdf')

    expect(ingress.acceptFiles([file])).toBe(true)
    expect(onStage).toHaveBeenCalledWith([file], { id: 7, nickname: 'Bob' })
  })

  it('rejects a file larger than 50 MB', () => {
    const { ingress, onStage, onWarning } = setup()

    expect(ingress.acceptFiles([makeFile('large.png', 50 * 1024 * 1024 + 1)])).toBe(false)
    expect(onWarning).toHaveBeenCalledWith('文件最大支持 50MB')
    expect(onStage).not.toHaveBeenCalled()
  })

  it('does not stage when there is no active recipient', () => {
    const { ingress, onStage, onWarning } = setup(null)

    expect(ingress.acceptFiles([makeFile()])).toBe(false)
    expect(onStage).not.toHaveBeenCalled()
    expect(onWarning).not.toHaveBeenCalled()
  })
})
