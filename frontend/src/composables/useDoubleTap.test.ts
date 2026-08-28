import { describe, expect, it, vi } from 'vitest'
import { useDoubleTap } from './useDoubleTap'

function pointer(x = 0, y = 0, pointerType = 'touch'): PointerEvent {
  return new PointerEvent('pointerup', { clientX: x, clientY: y, pointerType })
}

describe('useDoubleTap', () => {
  it('triggers when the same payload is tapped twice within the delay and distance', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger, { delayMs: 320, movementPx: 16 })

    doubleTap.tap(pointer(20, 30), 7)
    vi.advanceTimersByTime(200)
    doubleTap.tap(pointer(25, 34), 7)

    expect(trigger).toHaveBeenCalledOnce()
    expect(trigger).toHaveBeenCalledWith(7)
    vi.useRealTimers()
  })

  it('does not trigger for different payloads', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger)

    doubleTap.tap(pointer(20, 30), 7)
    vi.advanceTimersByTime(150)
    doubleTap.tap(pointer(20, 30), 8)

    expect(trigger).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not trigger when taps are too far apart', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger, { movementPx: 16 })

    doubleTap.tap(pointer(0, 0), 7)
    vi.advanceTimersByTime(100)
    doubleTap.tap(pointer(30, 0), 7)

    expect(trigger).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('ignores non-touch pointers', () => {
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger)

    doubleTap.tap(pointer(10, 10, 'mouse'), 7)
    doubleTap.tap(pointer(10, 10, 'mouse'), 7)

    expect(trigger).not.toHaveBeenCalled()
  })
})
