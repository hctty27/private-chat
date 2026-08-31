import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIncomingCallAlert } from './useIncomingCallAlert'

describe('useIncomingCallAlert', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('starts and stops a best-effort ringtone without leaking timers', async () => {
    vi.useFakeTimers()
    const oscillator = {
      type: 'sine',
      frequency: { value: 0 },
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    const gain = {
      gain: {
        value: 0,
        setValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
      close: vi.fn(async () => undefined),
    }
    const AudioContextMock = vi.fn(() => context)
    const vibrate = vi.fn(() => true)

    vi.stubGlobal('AudioContext', AudioContextMock)
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: AudioContextMock,
    })
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: vibrate,
    })

    const alert = useIncomingCallAlert()
    alert.start()
    await Promise.resolve()

    expect(AudioContextMock).toHaveBeenCalledTimes(1)
    expect(oscillator.start).toHaveBeenCalledTimes(1)
    expect(gain.gain.setValueAtTime).toHaveBeenCalled()
    expect(vibrate).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2500)
    expect(vibrate.mock.calls.length).toBeGreaterThan(1)

    alert.stop()

    expect(oscillator.stop).toHaveBeenCalledTimes(1)
    expect(oscillator.disconnect).toHaveBeenCalledTimes(1)
    expect(gain.disconnect).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenLastCalledWith(0)
  })

  it('does not create duplicate ringtone contexts', async () => {
    const context = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: vi.fn(async () => undefined),
      createOscillator: vi.fn(() => ({
        type: 'sine',
        frequency: { value: 0 },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createGain: vi.fn(() => ({
        gain: { value: 0, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      close: vi.fn(async () => undefined),
    }
    const AudioContextMock = vi.fn(() => context)
    vi.stubGlobal('AudioContext', AudioContextMock)
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: AudioContextMock,
    })

    const alert = useIncomingCallAlert()
    alert.start()
    alert.start()
    await Promise.resolve()

    expect(AudioContextMock).toHaveBeenCalledTimes(1)
    alert.stop()
  })
})
