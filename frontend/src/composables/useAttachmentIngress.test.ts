import { describe, expect, it, vi } from 'vitest'
import { useAttachmentIngress } from './useAttachmentIngress'

function makeFile(name = 'photo.png', size = 1024) {
  const file = new File(['x'], name, { type: 'image/png' })
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

  it('stages exactly one pasted file and prevents default', () => {
    const { ingress, onStage } = setup()
    const file = makeFile()
    const event = makePasteEvent([file])

    expect(ingress.handlePaste(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(onStage).toHaveBeenCalledWith(file, { id: 7, nickname: 'Bob' })
  })

  it('stages exactly one dropped file and prevents default navigation', () => {
    const { ingress, onStage } = setup()
    const file = makeFile('report.pdf')
    const event = makeDropEvent([file])

    expect(ingress.handleDrop(event)).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(onStage).toHaveBeenCalledWith(file, { id: 7, nickname: 'Bob' })
  })

  it('rejects multiple files with an explicit warning', () => {
    const { ingress, onStage, onWarning } = setup()

    expect(ingress.acceptFiles([makeFile('a.png'), makeFile('b.png')])).toBe(false)
    expect(onWarning).toHaveBeenCalledWith('暂时只支持一次发送 1 个文件')
    expect(onStage).not.toHaveBeenCalled()
  })

  it('rejects a file larger than 50 MB', () => {
    const { ingress, onStage, onWarning } = setup()

    expect(ingress.acceptFiles([makeFile('large.bin', 50 * 1024 * 1024 + 1)])).toBe(false)
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
