import { describe, expect, it, vi } from 'vitest'
import { useMobileChatHistory } from './useMobileChatHistory'

type RouterLike = Parameters<typeof useMobileChatHistory>[0]

function router(): RouterLike {
  return {
    push: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
    back: vi.fn(),
  }
}

describe('useMobileChatHistory', () => {
  it('replaces the baseline list state without changing the route', async () => {
    const r = router()
    const history = useMobileChatHistory(r)

    await history.replaceList()

    expect(r.replace).toHaveBeenCalledWith({
      name: 'mobile-chat',
      force: true,
      state: { privateChatUi: { kind: 'list' } },
    })
  })

  it('pushes chat and overlay entries on the same route', async () => {
    const r = router()
    const history = useMobileChatHistory(r)

    await history.pushChat(7)
    await history.pushOverlay(7, 'media')

    expect(r.push).toHaveBeenNthCalledWith(1, {
      name: 'mobile-chat',
      force: true,
      state: { privateChatUi: { kind: 'chat', contactId: 7 } },
    })
    expect(r.push).toHaveBeenNthCalledWith(2, {
      name: 'mobile-chat',
      force: true,
      state: { privateChatUi: { kind: 'overlay', contactId: 7, overlay: 'media' } },
    })
  })

  it('does not duplicate the same overlay entry', async () => {
    const r = router()
    window.history.replaceState({ privateChatUi: { kind: 'overlay', contactId: 7, overlay: 'emoji' } }, '')
    const history = useMobileChatHistory(r)

    await history.pushOverlay(7, 'emoji')

    expect(r.push).not.toHaveBeenCalled()
  })

  it('falls back to list for missing or malformed state', () => {
    const r = router()
    const history = useMobileChatHistory(r)

    window.history.replaceState({}, '')
    expect(history.read()).toEqual({ kind: 'list' })

    window.history.replaceState({ privateChatUi: { kind: 'chat', contactId: 'bad' } }, '')
    expect(history.read()).toEqual({ kind: 'list' })
  })

  it('delegates back to Vue Router', () => {
    const r = router()
    const history = useMobileChatHistory(r)

    history.back()

    expect(r.back).toHaveBeenCalledOnce()
  })

  it('subscribes to popstate and removes the listener', () => {
    const r = router()
    const history = useMobileChatHistory(r)
    const listener = vi.fn()
    const unsubscribe = history.subscribe(listener)

    window.history.replaceState({ privateChatUi: { kind: 'chat', contactId: 9 } }, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))

    expect(listener).toHaveBeenCalledWith({ kind: 'chat', contactId: 9 })

    unsubscribe()
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
