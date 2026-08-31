import axios from 'axios'
import type { ApiResponse, Availability, LoginResponse, SessionResponse, Contact, MessagesResponse, FileUploadResponse, FilePresignUploadResponse, FileMultipartCompletedPart, WebRTCIceConfig, WebRTCStatus } from '../types'
import { forceLogout } from '../auth/session'

const api = axios.create({
  baseURL: '/',
  timeout: 30000,
  withCredentials: true,
})

const thumbnailMaxEdge = 640
const thumbnailQuality = 0.8

export function handleApiError(error: any) {
  const isLoginRequest = error.config?.url === '/api/auth/login'
  if (error.response?.status === 401 && !isLoginRequest) {
    forceLogout('登录已过期，请重新进入')
  }
  return Promise.reject(error)
}

api.interceptors.response.use(
  (response) => response,
  handleApiError
)

export function login(username: string, password: string) {
  return api.post<ApiResponse<LoginResponse>>('/api/auth/login', { username, password })
}

export function checkSession() {
  return api.get<ApiResponse<SessionResponse>>('/api/auth/session')
}

export function getContacts() {
  return api.get<ApiResponse<Contact[]>>('/api/contacts')
}

export function getWebRTCStatus() {
  return api.get<ApiResponse<WebRTCStatus>>('/api/webrtc/status')
}

export function getWebRTCIceConfig() {
  return api.get<ApiResponse<WebRTCIceConfig>>('/api/webrtc/ice-config')
}

export function getAvailability() {
  return api.get<ApiResponse<Availability | null>>('/api/availability')
}

export function setAvailability(payload: { startAt: string; endAt: string; note: string | null }) {
  return api.put<ApiResponse<Availability>>('/api/availability', payload)
}

export function clearAvailability() {
  return api.delete<ApiResponse<null>>('/api/availability')
}

export function getMessages(targetId: number, cursor?: string, size = 20, mode: 'init' | 'loadMore' = 'init') {
  const params: Record<string, string | number> = { size, mode }
  if (cursor) params.cursor = cursor
  return api.get<ApiResponse<MessagesResponse>>(`/api/messages/${targetId}`, { params })
}

async function createImageThumbnail(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return null

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const longestEdge = Math.max(bitmap.width, bitmap.height)
    const scale = longestEdge > thumbnailMaxEdge ? thumbnailMaxEdge / longestEdge : 1
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, width, height)

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', thumbnailQuality)
    })
  } catch {
    return null
  } finally {
    bitmap?.close()
  }
}


function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadeddata' | 'seeked', timeoutMs = 4000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error(`video ${eventName} timeout`))
    }, timeoutMs)

    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('video preview load failed'))
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener(eventName, onEvent)
      video.removeEventListener('error', onError)
    }

    video.addEventListener(eventName, onEvent, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}

async function createVideoThumbnail(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('video/')) return null

  const objectUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = objectUrl

  try {
    await waitForVideoEvent(video, 'loadeddata')

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const seekTime = duration > 0.2 ? Math.min(0.5, duration * 0.1) : 0
    if (seekTime > 0) {
      video.currentTime = seekTime
      await waitForVideoEvent(video, 'seeked')
    }

    const sourceWidth = video.videoWidth
    const sourceHeight = video.videoHeight
    if (!sourceWidth || !sourceHeight) return null

    const longestEdge = Math.max(sourceWidth, sourceHeight)
    const scale = longestEdge > thumbnailMaxEdge ? thumbnailMaxEdge / longestEdge : 1
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, width, height)

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', thumbnailQuality)
    })
  } catch {
    return null
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(objectUrl)
  }
}

async function createMediaThumbnail(file: File): Promise<Blob | null> {
  if (file.type.startsWith('image/')) return createImageThumbnail(file)
  if (file.type.startsWith('video/')) return createVideoThumbnail(file)
  return null
}

const uploadTimeoutMs = 600000
const multipartConcurrency = 3
const multipartMaxAttempts = 3

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('upload aborted'))
      return
    }

    const timer = window.setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      cleanup()
      reject(new Error('upload aborted'))
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function responseEtag(headers: any) {
  const value = typeof headers?.get === 'function'
    ? headers.get('etag')
    : headers?.etag ?? headers?.ETag
  return typeof value === 'string' ? value.replace(/^"|"$/g, '') : ''
}

async function uploadSingle(
  uploadUrl: string,
  file: File,
  headers: Record<string, string> | undefined,
  contentType: string,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
) {
  await axios.put(uploadUrl, file, {
    headers: headers || { 'Content-Type': contentType },
    timeout: uploadTimeoutMs,
    signal,
    onUploadProgress: (event) => {
      if (!event.total || !onProgress) return
      onProgress(Math.round((event.loaded * 100) / event.total))
    },
  })
}

async function uploadMultipart(
  file: File,
  plan: FilePresignUploadResponse,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<FileMultipartCompletedPart[]> {
  const uploadId = plan.uploadId
  const partSize = plan.partSize
  const parts = plan.parts
  if (!uploadId || !partSize || !parts?.length) {
    throw new Error('invalid multipart upload plan')
  }

  const loadedByPart = new Map<number, number>()
  const completed = new Map<number, FileMultipartCompletedPart>()
  const controller = new AbortController()
  const abortFromParent = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abortFromParent, { once: true })
  let nextIndex = 0

  const reportProgress = () => {
    if (!onProgress || file.size <= 0) return
    let loaded = 0
    for (const value of loadedByPart.values()) loaded += value
    onProgress(Math.min(99, Math.round((loaded * 100) / file.size)))
  }

  const uploadPart = async (index: number) => {
    const target = parts[index]
    const start = index * partSize
    const end = Math.min(file.size, start + partSize)
    const blob = file.slice(start, end)

    let lastError: unknown
    for (let attempt = 1; attempt <= multipartMaxAttempts; attempt++) {
      if (controller.signal.aborted) throw lastError ?? new Error('upload aborted')
      loadedByPart.set(target.partNumber, 0)
      reportProgress()

      try {
        const response = await axios.put(target.uploadUrl, blob, {
          timeout: uploadTimeoutMs,
          signal: controller.signal,
          onUploadProgress: (event) => {
            loadedByPart.set(target.partNumber, Math.min(blob.size, event.loaded))
            reportProgress()
          },
        })
        const etag = responseEtag(response.headers)
        if (!etag) throw new Error('multipart upload response missing ETag')

        loadedByPart.set(target.partNumber, blob.size)
        completed.set(target.partNumber, { partNumber: target.partNumber, etag })
        reportProgress()
        return
      } catch (error) {
        lastError = error
        if (controller.signal.aborted || attempt === multipartMaxAttempts) throw error
        await delay(500 * 2 ** (attempt - 1), controller.signal)
      }
    }
    throw lastError
  }

  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = nextIndex++
      if (index >= parts.length) return
      await uploadPart(index)
    }
  }

  try {
    const workerCount = Math.min(multipartConcurrency, parts.length)
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return Array.from(completed.values()).sort((a, b) => a.partNumber - b.partNumber)
  } catch (error) {
    controller.abort()
    throw error
  } finally {
    signal?.removeEventListener('abort', abortFromParent)
  }
}

async function uploadThumbnail(
  thumbnailPromise: Promise<Blob | null>,
  uploadUrl?: string,
  headers?: Record<string, string>,
  signal?: AbortSignal,
) {
  if (!uploadUrl || signal?.aborted) return
  const thumbnail = await thumbnailPromise
  if (!thumbnail || signal?.aborted) return

  try {
    await axios.put(uploadUrl, thumbnail, {
      headers: headers || { 'Content-Type': 'image/jpeg' },
      timeout: uploadTimeoutMs,
      signal,
    })
  } catch {
    // Thumbnail upload is an optimization. The original file remains usable.
  }
}

export async function uploadFile(
  file: File,
  receiverId: number,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
) {
  const contentType = file.type || 'application/octet-stream'
  const presignRes = await api.post<ApiResponse<FilePresignUploadResponse>>('/api/file/presign-upload', {
    receiverId,
    fileName: file.name,
    contentType,
    fileSize: file.size,
  }, { signal })
  if (presignRes.data.code !== 200) {
    return presignRes
  }

  const plan = presignRes.data.data
  const {
    fileId,
    uploadMode,
    uploadUrl,
    uploadId,
    headers,
    thumbnailUploadUrl,
    thumbnailHeaders,
  } = plan
  const thumbnailPromise = thumbnailUploadUrl ? createMediaThumbnail(file) : Promise.resolve(null)

  try {
    let completedParts: FileMultipartCompletedPart[] | undefined
    if (uploadMode === 'multipart') {
      completedParts = await uploadMultipart(file, plan, onProgress, signal)
    } else {
      if (!uploadUrl) throw new Error('missing upload URL')
      await uploadSingle(uploadUrl, file, headers, contentType, onProgress, signal)
    }

    await uploadThumbnail(thumbnailPromise, thumbnailUploadUrl, thumbnailHeaders, signal)

    const completePayload = uploadMode === 'multipart'
      ? { uploadId, parts: completedParts }
      : undefined
    const response = await api.post<ApiResponse<FileUploadResponse>>(
      `/api/files/${fileId}/complete`,
      completePayload,
      { signal },
    )
    if (response.data.code === 200) onProgress?.(100)
    return response
  } catch (error) {
    if (uploadMode === 'multipart' && uploadId) {
      void api.post(`/api/files/${fileId}/multipart/abort`, { uploadId }).catch(() => undefined)
    }
    throw error
  }
}

export default api
