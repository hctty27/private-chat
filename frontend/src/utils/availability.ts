import type { Contact } from '../types'
import { formatLastSeen } from './time'

function localDaySerial(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
}

export function formatPlannedOnline(
  startAt: string | null | undefined,
  endAt: string | null | undefined,
  now = new Date(),
): string | null {
  if (!startAt || !endAt) return null

  const start = new Date(startAt)
  const end = new Date(endAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= now) return null
  if (start <= now) return '计划现在上线'

  const h = String(start.getHours()).padStart(2, '0')
  const m = String(start.getMinutes()).padStart(2, '0')
  const time = `${h}:${m}`
  const diffDays = Math.round((localDaySerial(start) - localDaySerial(now)) / 86400000)

  if (diffDays === 0) return `今天 ${time} 上线`
  if (diffDays === 1) return `明天 ${time} 上线`

  if (diffDays > 1 && diffDays < 7) {
    const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(start)
    return `${weekday} ${time} 上线`
  }

  const month = start.getMonth() + 1
  const day = start.getDate()
  return `${month}月${day}日 ${time} 上线`
}

export function hasPlannedAvailability(contact: Contact, now = new Date()): boolean {
  return formatPlannedOnline(contact.availabilityStartAt, contact.availabilityEndAt, now) !== null
}

export function formatContactPresence(
  contact: Contact,
  now = new Date(),
  includeLastSeen = true,
): string {
  if (contact.online) return '在线'
  const planned = formatPlannedOnline(contact.availabilityStartAt, contact.availabilityEndAt, now)
  if (planned) return planned
  return includeLastSeen ? formatLastSeen(contact.lastSeenAt, now) : '离线'
}
