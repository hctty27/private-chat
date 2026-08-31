export const voiceMaxDurationMs = 60_000
export const voiceMinDurationMs = 1_000

export const voiceMimeCandidates = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg;codecs=opus',
] as const

export function pickVoiceMimeType(isSupported: (mimeType: string) => boolean) {
  return voiceMimeCandidates.find((mimeType) => isSupported(mimeType)) ?? ''
}

export function voiceFileExtension(mimeType: string) {
  const normalized = mimeType.toLowerCase().split(';')[0]
  if (normalized === 'audio/mp4' || normalized === 'audio/x-m4a') return 'm4a'
  if (normalized === 'audio/webm') return 'webm'
  if (normalized === 'audio/ogg') return 'ogg'
  if (normalized === 'audio/mpeg') return 'mp3'
  if (normalized === 'audio/aac') return 'aac'
  if (normalized === 'audio/wav' || normalized === 'audio/x-wav') return 'wav'
  return 'audio'
}
