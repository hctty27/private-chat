import { describe, expect, it } from 'vitest'
import { pickVoiceMimeType, voiceFileExtension } from './voiceRecording'

describe('voiceRecording', () => {
  it('prefers opus webm and falls back to mp4', () => {
    expect(pickVoiceMimeType((type) => type === 'audio/webm;codecs=opus')).toBe('audio/webm;codecs=opus')
    expect(pickVoiceMimeType((type) => type === 'audio/mp4')).toBe('audio/mp4')
    expect(pickVoiceMimeType(() => false)).toBe('')
  })

  it('maps recording mime types to file extensions', () => {
    expect(voiceFileExtension('audio/webm;codecs=opus')).toBe('webm')
    expect(voiceFileExtension('audio/mp4')).toBe('m4a')
    expect(voiceFileExtension('audio/ogg;codecs=opus')).toBe('ogg')
  })
})
