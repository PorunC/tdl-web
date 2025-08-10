import { useState, useEffect, useMemo } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { useTaskStore, Task } from '@/store/taskStore'
import { useDownloadStore } from '@/store/downloadStore'
import { useAuth } from '@/hooks/useAuth'
import { useWebSocket } from '@/hooks/useWebSocket'
import { QuickDownloadDialog } from '@/components/QuickDownloadDialog'
import { DownloadSettings } from '@/components/DownloadSettings'
import { ImportChatDialog } from '@/components/ImportChatDialog'
import { ApiService } from '@/utils/api'
import { 
  Pause, 
  Play, 
  Square, 
  RotateCcw, 
  Trash2, 
  Clock,
  CheckCircle2,
  AlertCircle,
  XCircle,
  FileDown,
  TrendingUp
} from 'lucide-react'

type TaskFilter = 'all' | 'running' | 'completed' | 'error' | 'pending'

const DownloadPage = () => {
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const { toast } = useToast()
  const { isAuthenticated } = useAuth()
  
  const {
    tasks,
    getDownloadTasks,
    pauseTask,
    resumeTask,
    retryTask,
    removeTask,
    clearCompletedTasks,
    updateTask
  } = useTaskStore()
  
  const { loadSettings } = useDownloadStore()
  
  // WebSocket 连接已在 App.tsx 中全局处理，这里不需要重复连接
  
  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [loadSettings])
  
  // Load existing tasks from API - 只在初始化时检查一次
  useEffect(() => {
    if (!isAuthenticated) return
    
    const loadTasks = async () => {
      try {
        const response = await ApiService.getDownloadTasks()
        if (response.data.success && response.data.data.tasks) {
          const apiTasks = response.data.data.tasks
          // Sync with store if needed
          apiTasks.forEach((apiTask: any) => {
            const existingTask = tasks.find(t => t.id === apiTask.id)
            if (!existingTask) {
              updateTask(apiTask.id, {
                ...apiTask,
                type: 'download',
                createdAt: apiTask.created_at || new Date().toISOString()
              })
            }
          })
        }
      } catch (error) {
        console.error('Failed to load tasks:', error)
      }
    }
    
    // 只在首次认证时加载，避免重复检查
    if (isAuthenticated) {
      loadTasks()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]) // 移除 updateTask 依赖，避免循环调用
  
  // Filter tasks based on current filter and search term
  const filteredTasks = useMemo(() => {
    let filtered = getDownloadTasks()
    
    if (filter !== 'all') {
      filtered = filtered.filter(task => task.status === filter)
    }
    
    if (searchTerm) {
      filtered = filtered.filter(task => 
        task.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        task.chatInfo?.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        task.chatInfo?.username?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }
    
    return filtered.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }, [getDownloadTasks, filter, searchTerm])
  
  // Statistics
  const stats = useMemo(() => {
    const downloadTasks = getDownloadTasks()
    return {
      total: downloadTasks.length,
      running: downloadTasks.filter(t => t.status === 'running').length,
      completed: downloadTasks.filter(t => t.status === 'completed').length,
      error: downloadTasks.filter(t => t.status === 'error').length,
      pending: downloadTasks.filter(t => t.status === 'pending').length,
      paused: downloadTasks.filter(t => t.status === 'paused').length
    }
  }, [getDownloadTasks])
  
  const handleTaskAction = async (taskId: string, action: string) => {
    try {
      switch (action) {
        case 'pause':
          await ApiService.pauseDownloadTask(taskId)
          pauseTask(taskId)
          toast({ title: '任务已暂停' })
          break
          
        case 'resume':
          await ApiService.resumeDownloadTask(taskId)
          resumeTask(taskId)
          toast({ title: '任务已恢复' })
          break
          
        case 'retry':
          await ApiService.retryDownloadTask(taskId)
          retryTask(taskId)
          toast({ title: '任务已重试' })
          break
          
        case 'cancel':
          await ApiService.cancelDownloadTask(taskId)
          removeTask(taskId)
          toast({ title: '任务已取消' })
          break
          
        case 'remove':
          removeTask(taskId)
          toast({ title: '任务已删除' })
          break
      }
    } catch (error: any) {
      toast({
        title: '操作失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    }
  }
  
  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'running': return 'bg-blue-100 text-blue-800'
      case 'completed': return 'bg-green-100 text-green-800'
      case 'error': return 'bg-red-100 text-red-800'
      case 'paused': return 'bg-yellow-100 text-yellow-800'
      case 'cancelled': return 'bg-gray-100 text-gray-800'
      case 'pending': return 'bg-orange-100 text-orange-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }
  
  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'running': return <TrendingUp className="h-4 w-4" />
      case 'completed': return <CheckCircle2 className="h-4 w-4" />
      case 'error': return <AlertCircle className="h-4 w-4" />
      case 'paused': return <Pause className="h-4 w-4" />
      case 'cancelled': return <XCircle className="h-4 w-4" />
      case 'pending': return <Clock className="h-4 w-4" />
      default: return <FileDown className="h-4 w-4" />
    }
  }
  
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">下载管理</h1>
          <p className="text-muted-foreground">
            管理和监控 Telegram 文件下载任务
          </p>
        </div>
        <div className="flex gap-2">
          <QuickDownloadDialog />
          <ImportChatDialog />
          <DownloadSettings />
        </div>
      </div>
      
      {/* Statistics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">总任务</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <FileDown className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">运行中</p>
                <p className="text-2xl font-bold text-blue-600">{stats.running}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">已完成</p>
                <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">等待中</p>
                <p className="text-2xl font-bold text-orange-600">{stats.pending}</p>
              </div>
              <Clock className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">已暂停</p>
                <p className="text-2xl font-bold text-yellow-600">{stats.paused}</p>
              </div>
              <Pause className="h-8 w-8 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">错误</p>
                <p className="text-2xl font-bold text-red-600">{stats.error}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-600" />
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Filter and Search */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>下载任务</CardTitle>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => clearCompletedTasks()}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                清理已完成
              </Button>
            </div>
          </div>
          
          <div className="flex gap-4 items-center">
            <div className="flex-1">
              <Input
                placeholder="搜索任务名称、聊天标题或用户名..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-sm"
              />
            </div>
            
            <Tabs value={filter} onValueChange={(v) => setFilter(v as TaskFilter)}>
              <TabsList>
                <TabsTrigger value="all">全部</TabsTrigger>
                <TabsTrigger value="running">运行中</TabsTrigger>
                <TabsTrigger value="pending">等待中</TabsTrigger>
                <TabsTrigger value="completed">已完成</TabsTrigger>
                <TabsTrigger value="error">错误</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        
        <CardContent>
          {filteredTasks.length === 0 ? (
            <div className="text-center py-12">
              <FileDown className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">
                {tasks.length === 0 ? '暂无下载任务' : '没有匹配的任务'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {tasks.length === 0 
                  ? '点击上方的「快速下载」按钮开始您的第一个下载任务'
                  : '尝试调整搜索条件或过滤器'
                }
              </p>
              {tasks.length === 0 && <QuickDownloadDialog />}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onAction={(action) => handleTaskAction(task.id, action)}
                  formatBytes={formatBytes}
                  getStatusColor={getStatusColor}
                  getStatusIcon={getStatusIcon}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// Task Card Component
interface TaskCardProps {
  task: Task
  onAction: (action: string) => void
  formatBytes: (bytes: number) => string
  getStatusColor: (status: Task['status']) => string
  getStatusIcon: (status: Task['status']) => React.ReactNode
}

function TaskCard({ task, onAction, formatBytes, getStatusColor, getStatusIcon }: TaskCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-medium truncate">{task.name}</h4>
              <Badge className={getStatusColor(task.status)}>
                {getStatusIcon(task.status)}
                <span className="ml-1">{task.status}</span>
              </Badge>
              {task.resumable && (
                <Badge variant="outline" className="text-xs">
                  可续传
                </Badge>
              )}
            </div>
            
            {task.chatInfo && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                <span>{task.chatInfo.title}</span>
                {task.chatInfo.username && (
                  <span className="font-mono">@{task.chatInfo.username}</span>
                )}
                <Badge variant="outline" className="text-xs">
                  {task.chatInfo.type}
                </Badge>
              </div>
            )}
            
            {/* File Progress */}
            {task.fileProgress && (
              <div className="text-sm text-muted-foreground mb-2">
                <span>当前文件: {task.fileProgress.currentFile}</span>
                <span className="ml-2">
                  ({task.fileProgress.fileIndex + 1}/{task.fileProgress.totalFiles})
                </span>
              </div>
            )}
            
            {/* Progress */}
            <div className="space-y-1 mb-2">
              <div className="flex justify-between text-sm">
                <span>
                  {formatBytes(task.transferred)} / {formatBytes(task.total)}
                  {task.speed !== '0 B/s' && <span className="text-muted-foreground ml-2">({task.speed})</span>}
                </span>
                <span className="text-muted-foreground">
                  {task.progress.toFixed(1)}%
                  {task.eta !== '--' && <span className="ml-2">ETA: {task.eta}</span>}
                </span>
              </div>
              <Progress value={task.progress} className="h-2" />
            </div>
            
            {/* Statistics */}
            {task.statistics && (
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>总计: {task.statistics.filesTotal}</span>
                <span>完成: {task.statistics.filesCompleted}</span>
                <span>跳过: {task.statistics.filesSkipped}</span>
                {task.statistics.filesFailed > 0 && (
                  <span className="text-red-600">失败: {task.statistics.filesFailed}</span>
                )}
              </div>
            )}
            
            {task.error && (
              <div className="text-sm text-red-600 mt-2 p-2 bg-red-50 rounded">
                {task.error}
              </div>
            )}
          </div>
          
          <div className="flex gap-1 ml-4">
            {task.status === 'running' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction('pause')}
              >
                <Pause className="h-4 w-4" />
              </Button>
            )}
            
            {(task.status === 'paused' || task.status === 'error') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction(task.status === 'error' ? 'retry' : 'resume')}
              >
                {task.status === 'error' ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
            )}
            
            {task.status === 'running' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction('cancel')}
              >
                <Square className="h-4 w-4" />
              </Button>
            )}
            
            {['completed', 'error', 'cancelled'].includes(task.status) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onAction('remove')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default DownloadPage