import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getMessages, uploadFile } from '../api'
import { bindAttachmentRecipient } from '../utils/attachmentRecipient'
import { chatUploadQueue } from '../utils/uploadQueue'
import { useChatStore } from './chat'
import { useUserStore } from './user'
import type { Contact, Message } from '../types'

vi.mock('../api', () => ({
  getContacts: vi.fn(),
  getMessages: vi.fn(),
  uploadFile: vi.fn(),
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function contact(userId: number, nickname: string): Contact {
  return {
    userId,
    nickname,
    online: false,
    lastSeenAt: null,
    lastMessage: '',
    lastMessageTime: '',
    unreadCount: 0,
  }
}

function message(id: number, senderId: number, receiverId: number, content: string): Message {
  return {
    id,
    senderId,
    receiverId,
    msgType: 1,
    content,
    fileId: null,
    fileUrl: null,
    fileName: null,
    fileSize: null,
    isRead: 0,
    createdAt: '2026-08-14T06:00:00Z',
  }
}

describe('chat store conversation loading state', () => {
  beforeEach(() => {
    chatUploadQueue.clear()
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useUserStore().login(99, 'Me')
  })

  it('transitions initial load from loading to loaded', async () => {
    const pending = deferred<{ data: { code: number; data: { messages: Message[]; hasMore: boolean } } }>()
    vi.mocked(getMessages).mockReturnValueOnce(pending.promise as ReturnType<typeof getMessages>)

    const chatStore = useChatStore()
    chatStore.currentContact = contact(1, 'Alice')

    const load = chatStore.loadMessages('init')
    const stateWhilePending = chatStore.messageLoadState

    pending.resolve({
      data: {
        code: 200,
        data: { messages: [], hasMore: false },
      },
    })

    expect(await load).toBe(true)
    expect(stateWhilePending).toBe('loading')
    expect(chatStore.messageLoadState).toBe('loaded')
    expect(chatStore.messageLoadError).toBe('')
  })

  it('sets initial load error without fabricating an empty conversation', async () => {
    vi.mocked(getMessages).mockRejectedValueOnce(new Error('network down'))

    const chatStore = useChatStore()
    chatStore.currentContact = contact(1, 'Alice')

    expect(await chatStore.loadMessages('init')).toBe(false)
    expect(chatStore.messageLoadState).toBe('error')
    expect(chatStore.messageLoadError).toBe('消息加载失败，请重试')
  })

  it('does not let a stale contact response overwrite the active load state', async () => {
    const alice = deferred<{ data: { code: number; data: { messages: Message[]; hasMore: boolean } } }>()
    const bob = deferred<{ data: { code: number; data: { messages: Message[]; hasMore: boolean } } }>()
    vi.mocked(getMessages)
      .mockReturnValueOnce(alice.promise as ReturnType<typeof getMessages>)
      .mockReturnValueOnce(bob.promise as ReturnType<typeof getMessages>)

    const chatStore = useChatStore()
    chatStore.currentContact = contact(1, 'Alice')
    const aliceLoad = chatStore.loadMessages('init')

    chatStore.currentContact = contact(2, 'Bob')
    const bobLoad = chatStore.loadMessages('init')

    bob.resolve({
      data: {
        code: 200,
        data: { messages: [message(20, 2, 99, 'Bob latest')], hasMore: false },
      },
    })
    expect(await bobLoad).toBe(true)

    alice.resolve({
      data: {
        code: 200,
        data: { messages: [message(10, 1, 99, 'Alice stale')], hasMore: false },
      },
    })
    expect(await aliceLoad).toBe(false)

    expect(chatStore.currentContact?.userId).toBe(2)
    expect(chatStore.messages.map(item => item.id)).toEqual([20])
    expect(chatStore.messageLoadState).toBe('loaded')
    expect(chatStore.messageLoadError).toBe('')
  })

  it('restores a recent conversation immediately and refreshes it in the background', async () => {
    const refresh = deferred<{ data: { code: number; data: { messages: Message[]; hasMore: boolean; nextCursor?: string } } }>()

    vi.mocked(getMessages)
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: {
            messages: [message(10, 1, 99, 'Alice cached')],
            hasMore: false,
            nextCursor: '',
          },
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: {
            messages: [message(20, 2, 99, 'Bob latest')],
            hasMore: false,
            nextCursor: '',
          },
        },
      } as any)
      .mockReturnValueOnce(refresh.promise as ReturnType<typeof getMessages>)

    const chatStore = useChatStore()
    chatStore.contacts = [contact(1, 'Alice'), contact(2, 'Bob')]

    await chatStore.selectContact(1)
    await chatStore.selectContact(2)
    await chatStore.selectContact(1)

    expect(chatStore.currentContact?.userId).toBe(1)
    expect(chatStore.messages.map(item => item.id)).toEqual([10])
    expect(chatStore.messageLoadState).toBe('loaded')
    expect(getMessages).toHaveBeenCalledTimes(3)

    refresh.resolve({
      data: {
        code: 200,
        data: {
          messages: [
            message(10, 1, 99, 'Alice cached'),
            { ...message(11, 1, 99, 'Alice refreshed'), createdAt: '2026-08-14T06:01:00Z' },
          ],
          hasMore: false,
          nextCursor: '',
        },
      },
    })
    await refresh.promise
    await Promise.resolve()
    await Promise.resolve()

    expect(chatStore.messages.map(item => item.id)).toEqual([10, 11])
  })

  it('preserves loaded history and cursor when restoring a cached conversation', async () => {
    vi.mocked(getMessages)
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: {
            messages: [
              { ...message(10, 1, 99, 'Alice 10'), createdAt: '2026-08-14T06:10:00Z' },
              { ...message(11, 1, 99, 'Alice 11'), createdAt: '2026-08-14T06:11:00Z' },
            ],
            hasMore: true,
            nextCursor: 'cursor-initial',
          },
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: {
            messages: [
              { ...message(8, 1, 99, 'Alice 8'), createdAt: '2026-08-14T06:08:00Z' },
              { ...message(9, 1, 99, 'Alice 9'), createdAt: '2026-08-14T06:09:00Z' },
            ],
            hasMore: true,
            nextCursor: 'cursor-older',
          },
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: {
            messages: [message(20, 2, 99, 'Bob')],
            hasMore: false,
            nextCursor: '',
          },
        },
      } as any)
      .mockImplementationOnce(() => new Promise(() => {}) as ReturnType<typeof getMessages>)

    const chatStore = useChatStore()
    chatStore.contacts = [contact(1, 'Alice'), contact(2, 'Bob')]

    await chatStore.selectContact(1)
    await chatStore.loadMessages('loadMore')
    expect(chatStore.messages.map(item => item.id)).toEqual([8, 9, 10, 11])

    await chatStore.selectContact(2)
    await chatStore.selectContact(1)

    expect(chatStore.messages.map(item => item.id)).toEqual([8, 9, 10, 11])
    expect(chatStore.hasMore).toBe(true)

    vi.mocked(getMessages).mockResolvedValueOnce({
      data: {
        code: 200,
        data: {
          messages: [{ ...message(7, 1, 99, 'Alice 7'), createdAt: '2026-08-14T06:07:00Z' }],
          hasMore: false,
          nextCursor: '',
        },
      },
    } as any)

    expect(await chatStore.loadMessages('loadMore')).toBe(true)
    expect(getMessages).toHaveBeenLastCalledWith(1, 'cursor-older', 20, 'loadMore')
    expect(chatStore.messages.map(item => item.id)).toEqual([7, 8, 9, 10, 11])
  })

  it('evicts the least recently used conversation after five cached entries', async () => {
    vi.mocked(getMessages).mockImplementation(async (targetId: number) => ({
      data: {
        code: 200,
        data: {
          messages: [message(targetId * 10, targetId, 99, `contact-${targetId}`)],
          hasMore: false,
          nextCursor: '',
        },
      },
    } as any))

    const chatStore = useChatStore()
    chatStore.contacts = Array.from({ length: 6 }, (_, index) => contact(index + 1, `Contact ${index + 1}`))

    for (let targetId = 1; targetId <= 6; targetId += 1) {
      await chatStore.selectContact(targetId)
    }

    const callsBeforeRevisit = vi.mocked(getMessages).mock.calls.length
    await chatStore.selectContact(1)

    expect(vi.mocked(getMessages).mock.calls.length).toBe(callsBeforeRevisit + 1)
    expect(chatStore.messages.map(item => item.id)).toEqual([10])
  })

  it('keeps a staged attachment bound to its original recipient after switching contacts', async () => {
    const alice = contact(1, 'Alice')
    const bob = contact(2, 'Bob')
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    bindAttachmentRecipient([file], alice.userId)
    vi.mocked(uploadFile).mockResolvedValueOnce({
      data: {
        code: 200,
        data: {
          fileId: 10,
          url: '/api/files/10',
          fileName: file.name,
          fileSize: file.size,
        },
      },
    } as any)

    const chatStore = useChatStore()
    chatStore.currentContact = bob

    await chatStore.sendFile(file)

    expect(uploadFile).toHaveBeenCalledWith(file, alice.userId, expect.any(Function), expect.any(AbortSignal))
    expect(chatStore.messages).toHaveLength(0)
  })
  it('keeps chat interactive while a file upload is still running', async () => {
    const pendingUpload = deferred<any>()
    vi.mocked(uploadFile).mockReturnValueOnce(pendingUpload.promise as ReturnType<typeof uploadFile>)

    const chatStore = useChatStore()
    chatStore.currentContact = contact(1, 'Alice')
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })

    chatStore.sendFile(file)

    expect(chatStore.messages).toHaveLength(1)
    expect(chatStore.messages[0].localStatus).toBe('uploading')
    expect(uploadFile).toHaveBeenCalledTimes(1)

    chatStore.sendMessage('upload should not block this')

    expect(chatStore.messages).toHaveLength(2)
    expect(chatStore.messages[1].content).toBe('upload should not block this')
    expect(chatStore.messages[0].localStatus).toBe('uploading')

    pendingUpload.resolve({
      data: {
        code: 200,
        data: {
          fileId: 11,
          url: '/api/files/11/content',
          fileName: file.name,
          fileSize: file.size,
        },
      },
    })
    await pendingUpload.promise
    await Promise.resolve()
  })

  it('continues an upload after switching away from its conversation', async () => {
    const pendingUpload = deferred<any>()
    vi.mocked(uploadFile).mockReturnValueOnce(pendingUpload.promise as ReturnType<typeof uploadFile>)

    const chatStore = useChatStore()
    chatStore.currentContact = contact(1, 'Alice')
    const file = new File(['image'], 'photo.png', { type: 'image/png' })

    chatStore.sendFile(file)
    const localClientMsgId = chatStore.messages[0].clientMsgId

    chatStore.currentContact = contact(2, 'Bob')
    chatStore.messages = []

    pendingUpload.resolve({
      data: {
        code: 200,
        data: {
          fileId: 12,
          url: '/api/files/12/content',
          fileName: file.name,
          fileSize: file.size,
        },
      },
    })
    await pendingUpload.promise
    await Promise.resolve()

    vi.mocked(getMessages).mockResolvedValueOnce({
      data: {
        code: 200,
        data: { messages: [], hasMore: false },
      },
    } as any)
    chatStore.currentContact = contact(1, 'Alice')
    await chatStore.loadMessages('init')

    const restored = chatStore.messages.find((item) => item.clientMsgId === localClientMsgId)
    expect(restored?.fileId).toBe(12)
    expect(restored?.localStatus).toBe('queued')
  })

  it('keeps reply metadata on an optimistic text message', () => {
    const chatStore = useChatStore()
    chatStore.currentContact = contact(1, 'Alice')
    const original = message(123, 1, 99, 'original')
    chatStore.messages = [original]

    chatStore.sendMessage('reply', 1, original)

    const local = chatStore.messages.at(-1)
    expect(local?.replyToMessageId).toBe(123)
    expect(local?.replyTo).toEqual({
      messageId: 123,
      senderId: 1,
      msgType: 1,
      content: 'original',
      fileName: null,
    })
  })

  it('can cancel an active upload without affecting the conversation', async () => {
    vi.mocked(uploadFile).mockImplementationOnce((_file, _receiverId, _onProgress, signal) => (
      new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      }) as ReturnType<typeof uploadFile>
    ))

    const chatStore = useChatStore()
    chatStore.currentContact = contact(1, 'Alice')
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })

    chatStore.sendFile(file)
    const local = chatStore.messages[0]

    expect(local.localStatus).toBe('uploading')
    chatStore.cancelUpload(local.clientMsgId!)

    await Promise.resolve()
    await Promise.resolve()

    expect(local.localStatus).toBe('cancelled')

    chatStore.sendMessage('still works')
    expect(chatStore.messages.at(-1)?.content).toBe('still works')
  })

})
