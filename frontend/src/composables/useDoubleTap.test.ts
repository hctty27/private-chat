import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDoubleTap } from './useDoubleTap'

function pointer(type: string, x = 0, y = 0, pointerType = 'touch'): PointerEvent {
  return new PointerEvent(type, { clientX: x, clientY: y, pointerType })
}

function tap(doubleTap: ReturnType<typeof useDoubleTap<number>>, payload: number, x = 0, y = 0) {
  doubleTap.start(pointer('pointerdown', x, y), payload)
  doubleTap.end(pointer('pointerup', x, y))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useDoubleTap', () => {
  it('triggers with the second tap coordinates when the same payload is tapped twice', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger, { delayMs: 320, movementPx: 16 })

    tap(doubleTap, 7, 20, 30)
    vi.advanceTimersByTime(200)
    tap(doubleTap, 7, 25, 34)

    expect(trigger).toHaveBeenCalledOnce()
    expect(trigger).toHaveBeenCalledWith(7, { x: 25, y: 34 })
  })

  it('does not trigger for different payloads', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger)

    tap(doubleTap, 7, 20, 30)
    vi.advanceTimersByTime(150)
    tap(doubleTap, 8, 20, 30)

    expect(trigger).not.toHaveBeenCalled()
  })

  it('does not trigger when taps are too far apart', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T10:00:00Z'))
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger, { movementPx: 16 })

    tap(doubleTap, 7, 0, 0)
    vi.advanceTimersByTime(100)
    tap(doubleTap, 7, 30, 0)

    expect(trigger).not.toHaveBeenCalled()
  })

  it('cancels a tap when the pointer moves beyond the threshold', () => {
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger, { movementPx: 10 })

    doubleTap.start(pointer('pointerdown', 0, 0), 7)
    doubleTap.move(pointer('pointermove', 11, 0))
    doubleTap.end(pointer('pointerup', 11, 0))
    tap(doubleTap, 7, 11, 0)

    expect(trigger).not.toHaveBeenCalled()
  })

  it('ignores non-touch pointers', () => {
    const trigger = vi.fn()
    const doubleTap = useDoubleTap<number>(trigger)

    doubleTap.start(pointer('pointerdown', 10, 10, 'mouse'), 7)
    doubleTap.end(pointer('pointerup', 10, 10, 'mouse'))
    doubleTap.start(pointer('pointerdown', 10, 10, 'mouse'), 7)
    doubleTap.end(pointer('pointerup', 10, 10, 'mouse'))

    expect(trigger).not.toHaveBeenCalled()
  })
})
