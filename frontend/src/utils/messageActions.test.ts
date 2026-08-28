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
  it('returns reply and copy for persisted text and emoji', () => {
    expect(getMessageActions(message({ msgType: 1 }))).toEqual(['reply', 'copy'])
    expect(getMessageActions(message({ msgType: 4, content: '😀' }))).toEqual(['reply', 'copy'])
  })

  it('returns view and save for available images and videos', () => {
    expect(getMessageActions(message({ msgType: 2, fileUrl: '/api/files/1/content' }))).toEqual(['reply', 'view', 'save'])
    expect(getMessageActions(message({ msgType: 5, fileUrl: '/api/files/2/content' }))).toEqual(['reply', 'view', 'save'])
  })

  it('returns open and save for available files', () => {
    expect(getMessageActions(message({ msgType: 3, fileUrl: '/api/files/3/content' }))).toEqual(['reply', 'open', 'save'])
  })

  it('does not expose unavailable media actions before a file URL exists', () => {
    expect(getMessageActions(message({ msgType: 2, fileUrl: null }))).toEqual(['reply'])
    expect(getMessageActions(message({ msgType: 3, fileUrl: null }))).toEqual(['reply'])
    expect(getMessageActions(message({ msgType: 5, fileUrl: null }))).toEqual(['reply'])
  })

  it('prepends retry for failed text and limits failed attachments to retry', () => {
    expect(getMessageActions(message({ msgType: 1, localStatus: 'failed' }))).toEqual(['retry', 'reply', 'copy'])
    expect(getMessageActions(message({ msgType: 2, localStatus: 'failed', fileUrl: null }))).toEqual(['retry', 'reply'])
    expect(getMessageActions(message({ msgType: 3, localStatus: 'failed', fileUrl: '/api/files/3/content' }))).toEqual(['retry', 'reply'])
  })

  it('does not expose reply for an optimistic local message', () => {
    expect(getMessageActions(message({ id: -1, msgType: 1 }))).toEqual(['copy'])
  })
})
