import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { ApiService } from '@/utils/api'

interface Settings {
  globalProxy: string
  reconnectTimeout: number
  maxThreads: number
  maxTasks: number
  partSize: number
}

const SettingsPage = () => {
  const [settings, setSettings] = useState<Settings>({
    globalProxy: import.meta.env.VITE_GLOBAL_PROXY || '',
    reconnectTimeout: 300,
    maxThreads: 4,
    maxTasks: 2,
    partSize: 512
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      setLoading(true)
      const response = await ApiService.getSettings()
      if (response.data.success) {
        setSettings({ ...settings, ...response.data.data })
      }
    } catch (error: any) {
      toast({
        title: '加载设置失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    try {
      setSaving(true)
      const response = await ApiService.updateSettings(settings)
      if (response.data.success) {
        toast({
          title: '设置已保存',
          description: '配置更新成功，部分设置可能需要重启后生效'
        })
      } else {
        toast({
          title: '保存设置失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: '保存设置失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    } finally {
      setSaving(false)
    }
  }

  const resetSettings = () => {
    setSettings({
      globalProxy: '',
      reconnectTimeout: 300,
      maxThreads: 4,
      maxTasks: 2,
      partSize: 512
    })
    toast({
      title: '设置已重置',
      description: '已恢复默认设置，请记得保存'
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">设置</h1>
        <p className="text-muted-foreground">
          配置应用程序设置和首选项
        </p>
      </div>

      {/* 网络设置 */}
      <Card>
        <CardHeader>
          <CardTitle>网络设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="globalProxy">全局代理</Label>
            <Input
              id="globalProxy"
              value={settings.globalProxy}
              onChange={(e) => setSettings({ ...settings, globalProxy: e.target.value })}
              placeholder="http://127.0.0.1:7890"
              disabled={loading}
            />
            <p className="text-sm text-muted-foreground mt-1">
              用于访问Telegram API的代理服务器，留空则不使用代理
            </p>
          </div>

          <div>
            <Label htmlFor="reconnectTimeout">重连超时时间 (秒)</Label>
            <Input
              id="reconnectTimeout"
              type="number"
              value={settings.reconnectTimeout}
              onChange={(e) => setSettings({ ...settings, reconnectTimeout: parseInt(e.target.value) || 300 })}
              placeholder="300"
              disabled={loading}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Telegram客户端重连的超时时间，0表示无限制
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 性能设置 */}
      <Card>
        <CardHeader>
          <CardTitle>性能设置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="maxThreads">最大线程数</Label>
              <Input
                id="maxThreads"
                type="number"
                value={settings.maxThreads}
                onChange={(e) => setSettings({ ...settings, maxThreads: parseInt(e.target.value) || 4 })}
                placeholder="4"
                disabled={loading}
                min="1"
                max="16"
              />
              <p className="text-sm text-muted-foreground mt-1">
                单个任务的最大并发线程数 (1-16)
              </p>
            </div>

            <div>
              <Label htmlFor="maxTasks">最大并发任务数</Label>
              <Input
                id="maxTasks"
                type="number"
                value={settings.maxTasks}
                onChange={(e) => setSettings({ ...settings, maxTasks: parseInt(e.target.value) || 2 })}
                placeholder="2"
                disabled={loading}
                min="1"
                max="8"
              />
              <p className="text-sm text-muted-foreground mt-1">
                同时运行的最大任务数 (1-8)
              </p>
            </div>
          </div>

          <div>
            <Label htmlFor="partSize">分块大小 (KB)</Label>
            <Input
              id="partSize"
              type="number"
              value={settings.partSize}
              onChange={(e) => setSettings({ ...settings, partSize: parseInt(e.target.value) || 512 })}
              placeholder="512"
              disabled={loading}
              min="64"
              max="2048"
            />
            <p className="text-sm text-muted-foreground mt-1">
              文件传输的分块大小，范围64-2048KB，推荐512KB
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 操作按钮 */}
      <Card>
        <CardHeader>
          <CardTitle>操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button onClick={saveSettings} disabled={saving || loading}>
              {saving ? '保存中...' : '保存设置'}
            </Button>
            <Button onClick={resetSettings} variant="outline" disabled={loading}>
              重置为默认值
            </Button>
            <Button onClick={loadSettings} variant="outline" disabled={loading}>
              {loading ? '加载中...' : '重新加载'}
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            <p><strong>注意：</strong></p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>代理设置立即生效，用于新的API连接</li>
              <li>性能设置可能需要重启应用才能完全生效</li>
              <li>不当的设置可能会影响传输速度或稳定性</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* 环境信息 */}
      <Card>
        <CardHeader>
          <CardTitle>环境信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <strong>前端版本:</strong> {import.meta.env.VITE_NODE_ENV || 'development'}
            </div>
            <div>
              <strong>API地址:</strong> {import.meta.env.VITE_API_URL || '/api/v1'}
            </div>
            <div>
              <strong>后端地址:</strong> {import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080'}
            </div>
            <div>
              <strong>WebSocket地址:</strong> {import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws'}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default SettingsPage