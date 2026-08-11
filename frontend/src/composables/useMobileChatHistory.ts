import type { Router } from 'vue-router'

export type MobileOverlayKind = 'media' | 'emoji' | 'attachment'

export type MobileChatUiState =
  | { kind: 'list' }
  | { kind: 'chat'; contactId: number }
  | { kind: 'overlay'; contactId: number; overlay: MobileOverlayKind }

export type MobileChatRouter = Pick<Router, 'push' | 'replace' | 'back'>

const STATE_KEY = 'privateChatUi'
const overlays = new Set<MobileOverlayKind>(['media', 'emoji', 'attachment'])

function isContactId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function parseState(value: unknown): MobileChatUiState | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  if (state.kind === 'list') return { kind: 'list' }
  if (state.kind === 'chat' && isContactId(state.contactId)) {
    return { kind: 'chat', contactId: state.contactId }
  }
  if (
    state.kind === 'overlay' &&
    isContactId(state.contactId) &&
    typeof state.overlay === 'string' &&
    overlays.has(state.overlay as MobileOverlayKind)
  ) {
    return {
      kind: 'overlay',
      contactId: state.contactId,
      overlay: state.overlay as MobileOverlayKind,
    }
  }
  return null
}

function routeState(state: MobileChatUiState) {
  return {
    name: 'mobile-chat' as const,
    force: true,
    state: { [STATE_KEY]: state },
  }
}

export function useMobileChatHistory(router: MobileChatRouter) {
  function read(): MobileChatUiState {
    return parseState(window.history.state?.[STATE_KEY]) ?? { kind: 'list' }
  }

  async function replaceList() {
    await router.replace(routeState({ kind: 'list' }))
  }

  async function replaceChat(contactId: number) {
    await router.replace(routeState({ kind: 'chat', contactId }))
  }

  async function pushChat(contactId: number) {
    await router.push(routeState({ kind: 'chat', contactId }))
  }

  async function pushOverlay(contactId: number, overlay: MobileOverlayKind) {
    const current = read()
    const next: MobileChatUiState = { kind: 'overlay', contactId, overlay }
    if (
      current.kind === 'overlay' &&
      current.contactId === contactId &&
      current.overlay === overlay
    ) {
      return
    }
    if (current.kind === 'overlay') {
      await router.replace(routeState(next))
      return
    }
    await router.push(routeState(next))
  }

  function back() {
    router.back()
  }

  function subscribe(listener: (state: MobileChatUiState) => void) {
    const onPopState = () => listener(read())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }

  return {
    read,
    replaceList,
    replaceChat,
    pushChat,
    pushOverlay,
    back,
    subscribe,
  }
}
