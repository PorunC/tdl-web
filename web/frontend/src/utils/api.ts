import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证token
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response
  },
  (error) => {
    if (error.response?.status === 401) {
      // 处理认证失效
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// API服务类
export class ApiService {
  // 认证相关
  static async checkAuthStatus() {
    return api.get('/auth/status')
  }

  static async startQRLogin() {
    return api.post('/auth/qr/start')
  }

  static async checkQRStatus(sessionId: string) {
    return api.get(`/auth/qr/status/${sessionId}`)
  }

  static async startCodeLogin(phone: string) {
    return api.post('/auth/code/start', { phone })
  }

  static async verifyCode(sessionId: string, code: string) {
    return api.post('/auth/code/verify', { session_id: sessionId, code })
  }

  static async verifyPassword(sessionId: string, password: string) {
    return api.post('/auth/password/verify', { session_id: sessionId, password })
  }

  static async logout() {
    return api.post('/auth/logout')
  }

  // 下载相关
  static async getChats() {
    return api.get('/download/chats')
  }

  static async startDownload(data: {
    chatId: string
    fileTypes?: string[]
    filter?: string
  }) {
    return api.post('/download/start', data)
  }

  static async getDownloadTasks() {
    return api.get('/download/tasks')
  }

  static async cancelDownloadTask(taskId: string) {
    return api.delete(`/download/tasks/${taskId}`)
  }

  // 上传相关
  static async startUpload(data: {
    chatId: string
    files: FileList
    caption?: string
  }) {
    const formData = new FormData()
    formData.append('chatId', data.chatId)
    if (data.caption) {
      formData.append('caption', data.caption)
    }
    Array.from(data.files).forEach((file) => {
      formData.append('files', file)
    })

    return api.post('/upload/start', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  }

  static async getUploadTasks() {
    return api.get('/upload/tasks')
  }

  static async cancelUploadTask(taskId: string) {
    return api.delete(`/upload/tasks/${taskId}`)
  }

  // 设置相关
  static async getSettings() {
    return api.get('/settings')
  }

  static async updateSettings(settings: any) {
    return api.put('/settings', settings)
  }
}