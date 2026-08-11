import { describe, expect, it } from 'vitest'
import type { Message } from '../types'
import { getMessageActions } from './messageActions'

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    senderId: 1,
    receiverId: 2,
    msgType: 1,
    content: 'hello',
    fileId: null,
    fileUrl: null,
    fileName: null,
    fileSize: null,
    isRead: 0,
    createdAt: '2026-08-11T00:00:00Z',
    ...overrides,
  }
}

describe('getMessageActions', () => {
  it('returns copy for text and emoji', () => {
    expect(getMessageActions(message({ msgType: 1 }))).toEqual(['copy'])
    expect(getMessageActions(message({ msgType: 4, content: '😀' }))).toEqual(['copy'])
  })

  it('returns view and save for available images and videos', () => {
    expect(getMessageActions(message({ msgType: 2, fileUrl: '/api/files/1/content' }))).toEqual(['view', 'save'])
    expect(getMessageActions(message({ msgType: 5, fileUrl: '/api/files/2/content' }))).toEqual(['view', 'save'])
  })

  it('returns open and save for available files', () => {
    expect(getMessageActions(message({ msgType: 3, fileUrl: '/api/files/3/content' }))).toEqual(['open', 'save'])
  })

  it('does not expose unavailable media actions before a file URL exists', () => {
    expect(getMessageActions(message({ msgType: 2, fileUrl: null }))).toEqual([])
    expect(getMessageActions(message({ msgType: 3, fileUrl: null }))).toEqual([])
    expect(getMessageActions(message({ msgType: 5, fileUrl: null }))).toEqual([])
  })

  it('prepends retry for failed text and limits failed attachments to retry', () => {
    expect(getMessageActions(message({ msgType: 1, localStatus: 'failed' }))).toEqual(['retry', 'copy'])
    expect(getMessageActions(message({ msgType: 2, localStatus: 'failed', fileUrl: null }))).toEqual(['retry'])
    expect(getMessageActions(message({ msgType: 3, localStatus: 'failed', fileUrl: '/api/files/3/content' }))).toEqual(['retry'])
  })
})
