import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from './components/ui/toaster'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import DownloadPage from './pages/DownloadPage'
import UploadPage from './pages/UploadPage'
import SettingsPage from './pages/SettingsPage'
import { useAuthStore } from './store/authStore'
import { useEffect } from 'react'
import { useWebSocket } from './hooks/useWebSocket'

function App() {
  const { isAuthenticated, checkAuthStatus } = useAuthStore()
  
  // 初始化认证状态
  useEffect(() => {
    checkAuthStatus()
  }, [checkAuthStatus])

  // 建立WebSocket连接（仅在已认证时）
  useWebSocket(isAuthenticated)

  return (
    <div className="min-h-screen bg-background">
      {!isAuthenticated ? (
        <LoginPage />
      ) : (
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/download" element={<DownloadPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Layout>
      )}
      <Toaster />
    </div>
  )
}

export default App