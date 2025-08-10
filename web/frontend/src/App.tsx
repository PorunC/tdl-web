import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from './components/ui/toaster'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'
import DownloadPage from './pages/DownloadPage'
import SettingsPage from './pages/SettingsPage'
import { useAuthGuard } from './hooks/useAuth'
import { useWebSocket } from './hooks/useWebSocket'

function App() {
  const { isAuthenticated, shouldShowLoader } = useAuthGuard()

  // 建立WebSocket连接（仅在已认证时）
  useWebSocket(isAuthenticated)

  // 等待认证状态初始化完成
  if (shouldShowLoader) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-sm text-muted-foreground">正在检查认证状态...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {!isAuthenticated ? (
        <LoginPage />
      ) : (
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/settings" replace />} />
            <Route path="/dashboard" element={<Navigate to="/settings" replace />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/download" element={<DownloadPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/settings" replace />} />
          </Routes>
        </Layout>
      )}
      <Toaster />
    </div>
  )
}

export default App