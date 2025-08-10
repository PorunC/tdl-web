import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 生成或获取客户端ID
function getOrCreateClientID(): string {
  const STORAGE_KEY = 'tdl_client_id'
  let clientID = localStorage.getItem(STORAGE_KEY)
  
  if (!clientID) {
    // 生成新的客户端ID
    clientID = 'client_' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    localStorage.setItem(STORAGE_KEY, clientID)
  }
  
  return clientID
}

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    // 添加客户端ID到请求头
    const clientID = getOrCreateClientID()
    config.headers['X-TDL-Client-ID'] = clientID
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
    // Enhanced download options
    downloadPath?: string
    urls?: string[]
    template?: string
    include?: string[]
    exclude?: string[]
    takeout?: boolean
    continue?: boolean
    desc?: boolean
    taskId?: string
  }) {
    return api.post('/download/start', data)
  }

  static async getDownloadTasks() {
    return api.get('/download/tasks')
  }

  static async cancelDownloadTask(taskId: string) {
    return api.delete(`/download/tasks/${taskId}`)
  }

  static async pauseDownloadTask(taskId: string) {
    return api.post(`/download/tasks/${taskId}/pause`)
  }

  static async resumeDownloadTask(taskId: string) {
    return api.post(`/download/tasks/${taskId}/resume`)
  }

  static async retryDownloadTask(taskId: string) {
    return api.post(`/download/tasks/${taskId}/retry`)
  }

  static async getDownloadTaskDetails(taskId: string) {
    return api.get(`/download/tasks/${taskId}`)
  }

  static async startDownloadFromJson(data: {
    chatId: string
    downloadPath: string
    template?: string
    jsonData: any
    selectedMessageIds: number[]
    taskId: string
  }) {
    // Convert camelCase to snake_case for backend API
    const requestData = {
      chat_id: data.chatId,
      download_path: data.downloadPath,
      template: data.template,
      json_data: data.jsonData,
      selected_message_ids: data.selectedMessageIds,
      task_id: data.taskId
    }
    return api.post('/download/import', requestData)
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

  // 转发相关
  static async startForward(data: {
    from_sources: string[]
    to_chat: string
    edit_text?: string
    mode?: string
    silent?: boolean
    dry_run?: boolean
    single?: boolean
    desc?: boolean
    task_id?: string
  }) {
    return api.post('/forward/start', data)
  }

  static async getForwardTasks() {
    return api.get('/forward/tasks')
  }

  static async getForwardTaskDetails(taskId: string) {
    return api.get(`/forward/tasks/${taskId}`)
  }

  static async cancelForwardTask(taskId: string) {
    return api.delete(`/forward/tasks/${taskId}`)
  }

  // 上传相关
  static async startUpload(formData: FormData) {
    return api.post('/upload/start', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  }

  static async getUploadTasks() {
    return api.get('/upload/tasks')
  }

  static async getUploadTaskDetails(taskId: string) {
    return api.get(`/upload/tasks/${taskId}`)
  }

  static async cancelUploadTask(taskId: string) {
    return api.delete(`/upload/tasks/${taskId}`)
  }
}