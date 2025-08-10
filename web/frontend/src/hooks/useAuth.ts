import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/authStore'

/**
 * 优化的认证状态管理Hook
 * 减少不必要的API调用和状态检查
 */
export function useAuth() {
  const { 
    isAuthenticated, 
    isInitialized, 
    isLoading, 
    checkAuthStatus,
    user
  } = useAuthStore()
  
  const initRef = useRef(false)
  
  // 只在应用初始化时检查一次认证状态
  useEffect(() => {
    if (!initRef.current && !isInitialized) {
      console.log('[useAuth] Performing initial auth check')
      initRef.current = true
      checkAuthStatus()
    }
  }, [checkAuthStatus, isInitialized])
  
  return {
    isAuthenticated,
    isInitialized, 
    isLoading,
    user,
    checkAuthStatus
  }
}

/**
 * 用于需要认证保护的页面组件
 */
export function useAuthGuard() {
  const auth = useAuth()
  
  // 如果未初始化或正在加载，显示加载状态
  if (!auth.isInitialized || auth.isLoading) {
    return { ...auth, shouldShowLoader: true }
  }
  
  return { ...auth, shouldShowLoader: false }
}