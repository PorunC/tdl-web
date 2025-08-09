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

  static async startQRLogin(proxy?: string) {
    return api.post('/auth/qr/start', proxy ? { proxy } : {})
  }

  static async checkQRStatus(sessionId: string) {
    return api.get(`/auth/qr/status/${sessionId}`)
  }

  static async startCodeLogin(phone: string, proxy?: string) {
    return api.post('/auth/code/start', proxy ? { phone, proxy } : { phone })
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

  // 聊天管理相关
  static async getChatList(options?: {
    filter?: string
    output?: string
    page?: number
    limit?: number
    search?: string
  }) {
    const params: any = {
      filter: options?.filter || 'true',
      output: options?.output || 'json'
    }
    
    if (options?.page && options.page > 0) {
      params.page = options.page
    }
    if (options?.limit && options.limit > 0) {
      params.limit = options.limit
    }
    if (options?.search) {
      params.search = options.search
    }
    
    return api.get('/chat/list', { params })
  }

  static async getDefaultDownloadPath() {
    return api.get('/chat/default-path')
  }

  static async exportChatMessages(data: {
    type: 'time' | 'id' | 'last'
    chat: string
    thread?: number
    input: number[]
    filter?: string
    only_media?: boolean
    with_content?: boolean
    raw?: boolean
    all?: boolean
    output_path?: string
  }) {
    return api.post('/chat/export', data)
  }

  static async exportChatUsers(data: {
    chat: string
    raw?: boolean
    output_path?: string
  }) {
    return api.post('/chat/users', data)
  }

  // 设置相关
  static async getSettings() {
    return api.get('/settings')
  }

  static async updateSettings(settings: any) {
    return api.put('/settings', settings)
  }
}