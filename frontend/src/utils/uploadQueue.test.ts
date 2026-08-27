import { describe, expect, it, vi } from 'vitest'
import { UploadTaskQueue, largeUploadThreshold } from './uploadQueue'

type Deferred = {
  promise: Promise<void>
  resolve: () => void
}

function deferred(): Deferred {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flushQueue() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('UploadTaskQueue', () => {
  it('runs two small uploads concurrently and lets a large upload wait for exclusive capacity', async () => {
    const queue = new UploadTaskQueue(2)
    const first = deferred()
    const second = deferred()
    const large = deferred()
    const started: string[] = []

    queue.enqueue({
      id: 'small-1',
      size: 1024,
      run: async () => {
        started.push('small-1')
        await first.promise
      },
    })
    queue.enqueue({
      id: 'small-2',
      size: 1024,
      run: async () => {
        started.push('small-2')
        await second.promise
      },
    })
    queue.enqueue({
      id: 'large',
      size: largeUploadThreshold + 1,
      run: async () => {
        started.push('large')
        await large.promise
      },
    })

    expect(started).toEqual(['small-1', 'small-2'])

    first.resolve()
    await flushQueue()
    expect(started).toEqual(['small-1', 'small-2'])

    second.resolve()
    await flushQueue()
    expect(started).toEqual(['small-1', 'small-2', 'large'])

    large.resolve()
    await flushQueue()
  })

  it('keeps small uploads queued while a large upload is active', async () => {
    const queue = new UploadTaskQueue(2)
    const large = deferred()
    const small = deferred()
    const started: string[] = []

    queue.enqueue({
      id: 'large',
      size: largeUploadThreshold + 1,
      run: async () => {
        started.push('large')
        await large.promise
      },
    })
    queue.enqueue({
      id: 'small',
      size: 1024,
      run: async () => {
        started.push('small')
        await small.promise
      },
    })

    expect(started).toEqual(['large'])

    large.resolve()
    await flushQueue()
    expect(started).toEqual(['large', 'small'])

    small.resolve()
    await flushQueue()
  })

  it('aborts active uploads and reports cancellation', async () => {
    const queue = new UploadTaskQueue(2)
    const cancelled = vi.fn()
    let aborted = false

    queue.enqueue({
      id: 'active',
      size: 1024,
      onCancelled: cancelled,
      run: (signal) => new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        }, { once: true })
      }),
    })

    expect(queue.cancel('active')).toBe(true)
    await flushQueue()

    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(aborted).toBe(true)
  })
})
