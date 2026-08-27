export interface UploadQueueTask {
  id: string
  size: number
  run: (signal: AbortSignal) => Promise<void>
  onQueued?: () => void
  onStart?: () => void
  onCancelled?: () => void
}

type QueueEntry = {
  task: UploadQueueTask
  cost: number
  controller?: AbortController
  cancelled: boolean
}

export const largeUploadThreshold = 100 * 1024 * 1024

export class UploadTaskQueue {
  private readonly capacity: number
  private readonly pending: QueueEntry[] = []
  private readonly active = new Map<string, QueueEntry>()
  private usedCapacity = 0

  constructor(capacity = 2) {
    this.capacity = Math.max(1, capacity)
  }

  enqueue(task: UploadQueueTask) {
    this.cancel(task.id)

    const entry: QueueEntry = {
      task,
      cost: task.size > largeUploadThreshold ? this.capacity : 1,
      cancelled: false,
    }
    this.pending.push(entry)
    task.onQueued?.()
    this.pump()
  }

  cancel(id: string) {
    const pendingIndex = this.pending.findIndex((entry) => entry.task.id === id)
    if (pendingIndex >= 0) {
      const [entry] = this.pending.splice(pendingIndex, 1)
      entry.cancelled = true
      entry.task.onCancelled?.()
      return true
    }

    const entry = this.active.get(id)
    if (!entry || entry.cancelled) return false

    entry.cancelled = true
    entry.task.onCancelled?.()
    entry.controller?.abort()
    return true
  }

  clear() {
    const queued = this.pending.splice(0)
    for (const entry of queued) {
      entry.cancelled = true
      entry.task.onCancelled?.()
    }

    for (const entry of this.active.values()) {
      if (entry.cancelled) continue
      entry.cancelled = true
      entry.task.onCancelled?.()
      entry.controller?.abort()
    }
  }

  private pump() {
    while (this.pending.length > 0) {
      const entry = this.pending[0]
      if (this.usedCapacity + entry.cost > this.capacity) return

      this.pending.shift()
      this.start(entry)
    }
  }

  private start(entry: QueueEntry) {
    const controller = new AbortController()
    entry.controller = controller
    this.active.set(entry.task.id, entry)
    this.usedCapacity += entry.cost
    entry.task.onStart?.()

    void entry.task.run(controller.signal)
      .catch(() => undefined)
      .finally(() => {
        this.active.delete(entry.task.id)
        this.usedCapacity = Math.max(0, this.usedCapacity - entry.cost)
        this.pump()
      })
  }
}

export const chatUploadQueue = new UploadTaskQueue()
