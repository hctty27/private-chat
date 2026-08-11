export function useLongPress<T>(
  onTrigger: (payload: T, event: PointerEvent) => void,
  options: { delayMs?: number; movementPx?: number } = {},
): {
  start(event: PointerEvent, payload: T): void
  move(event: PointerEvent): void
  cancel(): void
} {
  const delayMs = options.delayMs ?? 500
  const movementPx = options.movementPx ?? 10
  let timer: ReturnType<typeof setTimeout> | null = null
  let startX = 0
  let startY = 0
  let payload: T | null = null
  let startEvent: PointerEvent | null = null

  function cancel() {
    if (timer) clearTimeout(timer)
    timer = null
    payload = null
    startEvent = null
  }

  function start(event: PointerEvent, nextPayload: T) {
    cancel()
    startX = event.clientX
    startY = event.clientY
    payload = nextPayload
    startEvent = event
    timer = setTimeout(() => {
      const currentPayload = payload
      const currentEvent = startEvent
      timer = null
      payload = null
      startEvent = null
      if (currentPayload !== null && currentEvent) onTrigger(currentPayload, currentEvent)
    }, delayMs)
  }

  function move(event: PointerEvent) {
    if (!timer) return
    if (Math.hypot(event.clientX - startX, event.clientY - startY) > movementPx) {
      cancel()
    }
  }

  return { start, move, cancel }
}
