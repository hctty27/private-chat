export interface IncomingCallAlert {
  start(): void
  stop(): void
}

export function useIncomingCallAlert(): IncomingCallAlert {
  let context: AudioContext | null = null
  let oscillator: OscillatorNode | null = null
  let gain: GainNode | null = null
  let ringTimer: ReturnType<typeof setInterval> | null = null
  const pulseTimers = new Set<ReturnType<typeof setTimeout>>()
  let running = false

  function setGain(value: number) {
    if (!gain || !context) return
    gain.gain.setValueAtTime(value, context.currentTime)
  }

  function schedulePulse(delay: number, value: number) {
    const timer = setTimeout(() => {
      pulseTimers.delete(timer)
      if (running) setGain(value)
    }, delay)
    pulseTimers.add(timer)
  }

  function ringPattern() {
    setGain(0.11)
    schedulePulse(380, 0)
    schedulePulse(620, 0.11)
    schedulePulse(1000, 0)
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([320, 220, 320])
    }
  }

  async function startAudio() {
    if (typeof window === 'undefined') return
    const AudioContextCtor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return

    try {
      const nextContext = new AudioContextCtor()
      context = nextContext
      if (nextContext.state === 'suspended') await nextContext.resume()
      if (!running || context !== nextContext) {
        await nextContext.close()
        return
      }

      oscillator = nextContext.createOscillator()
      gain = nextContext.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 520
      gain.gain.value = 0
      oscillator.connect(gain)
      gain.connect(nextContext.destination)
      oscillator.start()
      ringPattern()
      ringTimer = setInterval(ringPattern, 2400)
    } catch {
      if (context) {
        void context.close().catch(() => undefined)
      }
      context = null
      oscillator = null
      gain = null
    }
  }

  function start() {
    if (running) return
    running = true
    void startAudio()
  }

  function stop() {
    if (!running && !context && !ringTimer) return
    running = false

    if (ringTimer) clearInterval(ringTimer)
    ringTimer = null
    for (const timer of pulseTimers) clearTimeout(timer)
    pulseTimers.clear()

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0)
    }

    try {
      oscillator?.stop()
    } catch {
      // Already stopped.
    }
    oscillator?.disconnect()
    gain?.disconnect()
    oscillator = null
    gain = null

    const currentContext = context
    context = null
    if (currentContext) void currentContext.close().catch(() => undefined)
  }

  return { start, stop }
}
