import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLongPress } from './useLongPress'

function pointer(x = 0, y = 0): PointerEvent {
  return new PointerEvent('pointerdown', { clientX: x, clientY: y })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useLongPress', () => {
  it('triggers after the configured delay', () => {
    vi.useFakeTimers()
    const trigger = vi.fn()
    const longPress = useLongPress<string>(trigger, { delayMs: 500, movementPx: 10 })
    const event = pointer(20, 30)

    longPress.start(event, 'payload')
    vi.advanceTimersByTime(499)
    expect(trigger).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(trigger).toHaveBeenCalledOnce()
    expect(trigger).toHaveBeenCalledWith('payload', event)
  })

  it('cancels before the delay', () => {
    vi.useFakeTimers()
    const trigger = vi.fn()
    const longPress = useLongPress<string>(trigger)

    longPress.start(pointer(), 'payload')
    longPress.cancel()
    vi.runAllTimers()

    expect(trigger).not.toHaveBeenCalled()
  })

  it('cancels when pointer movement exceeds the threshold', () => {
    vi.useFakeTimers()
    const trigger = vi.fn()
    const longPress = useLongPress<string>(trigger, { delayMs: 500, movementPx: 10 })

    longPress.start(pointer(0, 0), 'payload')
    longPress.move(new PointerEvent('pointermove', { clientX: 11, clientY: 0 }))
    vi.runAllTimers()

    expect(trigger).not.toHaveBeenCalled()
  })

  it('replaces an earlier timer when a second press starts', () => {
    vi.useFakeTimers()
    const trigger = vi.fn()
    const longPress = useLongPress<string>(trigger, { delayMs: 500 })
    const second = pointer(2, 2)

    longPress.start(pointer(), 'first')
    vi.advanceTimersByTime(250)
    longPress.start(second, 'second')
    vi.advanceTimersByTime(500)

    expect(trigger).toHaveBeenCalledOnce()
    expect(trigger).toHaveBeenCalledWith('second', second)
  })
})
