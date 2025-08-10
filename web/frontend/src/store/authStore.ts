import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ApiService } from '@/utils/api'

interface User {
  id: number
  username: string
  phone: string
  first_name: string
  last_name: string
}

export type LoginStatus = 
  | 'initializing'
  | 'waiting_qr' 
  | 'waiting_code'
  | 'waiting_password'
  | 'completed'
  | 'failed'
  | 'expired'

interface LoginSession {
  sessionId: string
  status: LoginStatus
  error?: string
  needPassword?: boolean
  user?: User
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  isInitialized: boolean // 新增：标记认证状态是否已初始化
  loginSession: LoginSession | null
  
  // 基础认证方法
  checkAuthStatus: () => Promise<void>
  logout: () => Promise<void>
  
  // QR登录方法
  startQRLogin: (proxy?: string) => Promise<string>
  getQRCode: (sessionId: string) => string
  checkQRStatus: (sessionId: string) => Promise<void>
  
  // 验证码登录方法
  startCodeLogin: (phone: string, proxy?: string) => Promise<string>
  verifyCode: (sessionId: string, code: string) => Promise<void>
  
  // 2FA密码验证
  verifyPassword: (sessionId: string, password: string) => Promise<void>
  
  // 清理会话状态
  clearSession: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: false, // 初始时未初始化
      loginSession: null,

      checkAuthStatus: async () => {
        const currentState = get()
        
        // 如果最近已经检查过且状态有效，跳过检查
        const now = Date.now()
        const lastCheck = (currentState as any).lastAuthCheck || 0
        const oneMinute = 60 * 1000 // 1分钟内不重复检查
        
        if (currentState.isInitialized && currentState.isAuthenticated && (now - lastCheck < oneMinute)) {
          console.log('Auth status recently checked, skipping')
          return
        }
        
        try {
          set({ isLoading: true })
          const response = await ApiService.checkAuthStatus()
          if (response.data.success && response.data.data.authenticated) {
            set({ 
              user: response.data.data.user,
              isAuthenticated: true,
              isInitialized: true,
              isLoading: false
            })
          } else {
            set({ 
              user: null,
              isAuthenticated: false,
              isInitialized: true,
              isLoading: false
            })
          }
        } catch (error) {
          console.warn('Auth status check failed:', error)
          set({ 
            user: null,
            isAuthenticated: false,
            isInitialized: true,
            isLoading: false
          })
        }
      },

      logout: async () => {
        try {
          await ApiService.logout()
        } catch (error) {
          console.error('Logout error:', error)
        } finally {
          set({ 
            user: null, 
            isAuthenticated: false,
            isInitialized: true,
            loginSession: null
          })
        }
      },

      startQRLogin: async (proxy?: string) => {
        set({ isLoading: true, loginSession: null })
        try {
          const response = await ApiService.startQRLogin(proxy)
          const sessionId = response.data.data.session_id
          
          set({
            isLoading: false,
            loginSession: {
              sessionId,
              status: response.data.data.status
            }
          })
          
          return sessionId
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      getQRCode: (sessionId: string) => {
        return `/api/v1/auth/qr/code/${sessionId}?size=256`
      },

      checkQRStatus: async (sessionId: string) => {
        try {
          const response = await ApiService.checkQRStatus(sessionId)
          const data = response.data.data
          
          const currentSession = get().loginSession
          if (currentSession && currentSession.sessionId === sessionId) {
            set({
              loginSession: {
                ...currentSession,
                status: data.status,
                error: data.error,
                needPassword: data.need_password,
                user: data.user
              }
            })
            
            // 登录完成时更新认证状态
            if (data.status === 'completed' && data.user) {
              set({
                user: data.user,
                isAuthenticated: true,
                loginSession: null
              })
            }
          }
        } catch (error) {
          console.error('Check QR status error:', error)
          const currentSession = get().loginSession
          if (currentSession && currentSession.sessionId === sessionId) {
            set({
              loginSession: {
                ...currentSession,
                status: 'failed',
                error: 'Network error'
              }
            })
          }
        }
      },

      startCodeLogin: async (phone: string, proxy?: string) => {
        set({ isLoading: true, loginSession: null })
        try {
          const response = await ApiService.startCodeLogin(phone, proxy)
          const sessionId = response.data.data.session_id
          
          set({
            isLoading: false,
            loginSession: {
              sessionId,
              status: response.data.data.status
            }
          })
          
          return sessionId
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      verifyCode: async (sessionId: string, code: string) => {
        set({ isLoading: true })
        try {
          await ApiService.verifyCode(sessionId, code)
          set({ isLoading: false })
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      verifyPassword: async (sessionId: string, password: string) => {
        set({ isLoading: true })
        try {
          await ApiService.verifyPassword(sessionId, password)
          set({ isLoading: false })
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      clearSession: () => {
        set({ loginSession: null })
      }
    }),
    {
      name: 'tdl-auth-storage',
      partialize: (state) => ({ 
        user: state.user,
        // 优化：短时间内持久化认证状态，避免频繁检查
        isAuthenticated: state.isAuthenticated,
        isInitialized: state.isInitialized,
        // 添加时间戳用于验证有效性
        lastAuthCheck: Date.now()
      }),
      // 添加状态恢复逻辑
      onRehydrateStorage: () => (state) => {
        if (state) {
          const now = Date.now()
          const lastCheck = (state as any).lastAuthCheck || 0
          const fiveMinutes = 5 * 60 * 1000 // 5分钟有效期
          
          // 如果超过5分钟，重置认证状态
          if (now - lastCheck > fiveMinutes) {
            state.isAuthenticated = false
            state.isInitialized = false
            state.user = null
          }
        }
      }
    }
  )
)