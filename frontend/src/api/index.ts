import axios from 'axios'
import type { ApiResponse, LoginResponse, Contact, MessagesResponse, FilePresignUploadResponse } from '../types'
import router from '../router'

const api = axios.create({
  baseURL: '/',
  timeout: 30000,
})

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
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('userId')
      localStorage.removeItem('nickname')
      router.push('/')
    }
    return Promise.reject(error)
  }
)

export function login(username: string, password: string) {
  return api.post<ApiResponse<LoginResponse>>('/api/auth/login', { username, password })
}

export function getContacts() {
  return api.get<ApiResponse<Contact[]>>('/api/contacts')
}

export function getMessages(targetId: number, cursor?: string, size = 20, mode: 'init' | 'loadMore' = 'init') {
  const params: Record<string, string | number> = { size, mode }
  if (cursor) params.cursor = cursor
  return api.get<ApiResponse<MessagesResponse>>(`/api/messages/${targetId}`, { params })
}

export async function uploadFile(file: File, onProgress?: (p: number) => void) {
  const contentType = file.type || 'application/octet-stream'
  const presignRes = await api.post<ApiResponse<FilePresignUploadResponse>>('/api/file/presign-upload', {
    fileName: file.name,
    contentType,
    fileSize: file.size,
  })
  if (presignRes.data.code !== 200) {
    return presignRes
  }

  const { uploadUrl, headers } = presignRes.data.data
  await axios.put(uploadUrl, file, {
    headers: headers || { 'Content-Type': contentType },
    timeout: 600000,
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        onProgress(Math.round((e.loaded * 100) / e.total))
      }
    },
  })

  return presignRes
}

export default api
