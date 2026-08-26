import axios from 'axios'
import type { ApiResponse, LoginResponse, Contact, MessagesResponse, FileUploadResponse, FilePresignUploadResponse } from '../types'
import { forceLogout } from '../auth/session'

const api = axios.create({
  baseURL: '/',
  timeout: 30000,
})

const thumbnailMaxEdge = 640
const thumbnailQuality = 0.8

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url === '/api/auth/login'
    if (error.response?.status === 401 && !isLoginRequest) {
      forceLogout('登录已过期，请重新进入')
    }
    return Promise.reject(error)
  }
)

export function login(username: string, password: string) {
  return api.post<ApiResponse<LoginResponse>>('/api/auth/login', { username, password })
}

export function checkSession() {
  return api.get<ApiResponse<{ userId: number }>>('/api/auth/session')
}

export function getContacts() {
  return api.get<ApiResponse<Contact[]>>('/api/contacts')
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

export async function uploadFile(file: File, receiverId: number, onProgress?: (p: number) => void) {
  const contentType = file.type || 'application/octet-stream'
  const presignRes = await api.post<ApiResponse<FilePresignUploadResponse>>('/api/file/presign-upload', {
    receiverId,
    fileName: file.name,
    contentType,
    fileSize: file.size,
  })
  if (presignRes.data.code !== 200) {
    return presignRes
  }

  const { fileId, uploadUrl, headers, thumbnailUploadUrl, thumbnailHeaders } = presignRes.data.data
  const thumbnailPromise = thumbnailUploadUrl ? createImageThumbnail(file) : Promise.resolve(null)

  await axios.put(uploadUrl, file, {
    headers: headers || { 'Content-Type': contentType },
    timeout: 600000,
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        onProgress(Math.round((e.loaded * 100) / e.total))
      }
    },
  })

  const thumbnail = await thumbnailPromise
  if (thumbnail && thumbnailUploadUrl) {
    try {
      await axios.put(thumbnailUploadUrl, thumbnail, {
        headers: thumbnailHeaders || { 'Content-Type': 'image/jpeg' },
        timeout: 600000,
      })
    } catch {
      // Thumbnail upload is an optimization. The original file remains usable.
    }
  }

  return api.post<ApiResponse<FileUploadResponse>>(`/api/files/${fileId}/complete`)
}

export default api
