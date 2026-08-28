export function useDoubleTap<T>(
  onTrigger: (payload: T) => void,
  options: { delayMs?: number; movementPx?: number } = {},
): {
  start(event: PointerEvent, payload: T): void
  move(event: PointerEvent): void
  end(event: PointerEvent): void
  cancel(): void
} {
  const delayMs = options.delayMs ?? 320
  const movementPx = options.movementPx ?? 16

  let currentPayload: T | null = null
  let currentStartX = 0
  let currentStartY = 0
  let currentMoved = false

  let lastPayload: T | null = null
  let lastTapAt = 0
  let lastX = 0
  let lastY = 0

  function resetCurrent() {
    currentPayload = null
    currentMoved = false
  }

  function cancel() {
    resetCurrent()
  }

  function start(event: PointerEvent, payload: T) {
    resetCurrent()
    if (event.pointerType !== 'touch') return

    currentPayload = payload
    currentStartX = event.clientX
    currentStartY = event.clientY
  }

  function move(event: PointerEvent) {
    if (currentPayload === null || currentMoved) return
    if (Math.hypot(event.clientX - currentStartX, event.clientY - currentStartY) > movementPx) {
      currentMoved = true
    }
  }

  function end(event: PointerEvent) {
    if (event.pointerType !== 'touch' || currentPayload === null || currentMoved) {
      resetCurrent()
      return
    }

    const payload = currentPayload
    const now = Date.now()
    const isDoubleTap =
      lastPayload === payload &&
      now - lastTapAt <= delayMs &&
      Math.hypot(event.clientX - lastX, event.clientY - lastY) <= movementPx

    resetCurrent()

    if (isDoubleTap) {
      lastPayload = null
      lastTapAt = 0
      onTrigger(payload)
      return
    }

    lastPayload = payload
    lastTapAt = now
    lastX = event.clientX
    lastY = event.clientY
  }

  return { start, move, end, cancel }
}
