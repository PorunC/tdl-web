import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/components/ui/use-toast'
import { ApiService } from '@/utils/api'

interface UploadTask {
  id: string
  type: string
  name: string
  status: string
  progress: number
  speed: string
  eta: string
  uploaded: number
  total: number
  failed: number
  created_at: string
  error?: string
  to_chat: string
  file_paths: string[]
}

const UploadPage = () => {
  const [activeTab, setActiveTab] = useState('upload')
  const { toast } = useToast()

  // 上传表单状态
  const [toChat, setToChat] = useState('')
  const [excludes, setExcludes] = useState('')
  const [remove, setRemove] = useState(false)
  const [photo, setPhoto] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 任务管理状态
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const [loading, setLoading] = useState(false)
  const [tasksLoading, setTasksLoading] = useState(false)
  
  // 初始化状态
  const hasInitialized = useRef(false)
  const [initialized, setInitialized] = useState(false)

  // 初始化页面
  useEffect(() => {
    const initializePage = async () => {
      if (hasInitialized.current) {
        return
      }
      
      hasInitialized.current = true
      
      try {
        await fetchUploadTasks()
        setInitialized(true)
      } catch (error) {
        console.error('页面初始化失败:', error)
        setInitialized(true)
      }
    }
    
    initializePage()
  }, [])

  // 获取上传任务列表
  const fetchUploadTasks = async () => {
    try {
      setTasksLoading(true)
      const response = await ApiService.getUploadTasks()
      
      if (response.data.success) {
        setTasks(response.data.tasks || [])
      } else {
        toast({
          title: '获取上传任务失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      console.error('获取上传任务失败:', error)
      const errorMessage = error.response?.data?.message || error.message || '网络错误'
      
      if (!errorMessage.includes('authorized') && !errorMessage.includes('login')) {
        toast({
          title: '获取上传任务失败',
          description: errorMessage,
          variant: 'destructive'
        })
      }
    } finally {
      setTasksLoading(false)
    }
  }

  // 处理文件选择
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files && files.length > 0) {
      setSelectedFiles(files)
    }
  }

  // 处理拖拽
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      setSelectedFiles(files)
      // 同步到file input
      if (fileInputRef.current) {
        fileInputRef.current.files = files
      }
    }
  }, [])

  // 开始上传
  const handleStartUpload = async () => {
    if (!selectedFiles || selectedFiles.length === 0) {
      toast({
        title: '上传失败',
        description: '请选择要上传的文件',
        variant: 'destructive'
      })
      return
    }

    const formData = new FormData()
    
    // 处理目标聊天：空字符串或"me"都表示转发到Saved Messages
    const targetChat = toChat.trim()
    const finalToChat = targetChat === '' || targetChat.toLowerCase() === 'me' ? '' : targetChat
    
    formData.append('to_chat', finalToChat)
    formData.append('excludes', excludes.trim())
    formData.append('remove', remove.toString())
    formData.append('photo', photo.toString())
    formData.append('task_id', `upload_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`)

    // 添加文件
    Array.from(selectedFiles).forEach((file) => {
      formData.append('files', file)
    })

    try {
      setLoading(true)
      const response = await ApiService.startUpload(formData)
      
      if (response.data.success) {
        toast({
          title: '上传任务已提交',
          description: `任务ID: ${response.data.task_id}，文件数量: ${response.data.file_count}`
        })
        
        // 清空表单
        setSelectedFiles(null)
        setToChat('')
        setExcludes('')
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        
        // 刷新任务列表并切换到任务管理标签
        await fetchUploadTasks()
        setActiveTab('tasks')
      } else {
        toast({
          title: '上传失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: '上传失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  // 取消上传任务
  const handleCancelTask = async (taskId: string) => {
    try {
      const response = await ApiService.cancelUploadTask(taskId)
      
      if (response.data.success) {
        toast({
          title: '任务已取消',
          description: '上传任务已成功取消'
        })
        await fetchUploadTasks()
      } else {
        toast({
          title: '取消失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: '取消失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    }
  }

  // 格式化任务状态
  const formatTaskStatus = (status: string) => {
    switch (status) {
      case 'pending': return { text: '等待中', variant: 'secondary' }
      case 'running': return { text: '上传中', variant: 'default' }
      case 'completed': return { text: '已完成', variant: 'secondary' }
      case 'cancelled': return { text: '已取消', variant: 'outline' }
      case 'error': return { text: '失败', variant: 'destructive' }
      default: return { text: status, variant: 'secondary' }
    }
  }

  // 格式化文件大小
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">上传管理</h1>
        <p className="text-muted-foreground">
          上传文件到Telegram聊天，支持批量上传和任务管理
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="upload">文件上传</TabsTrigger>
          <TabsTrigger value="tasks">任务管理</TabsTrigger>
        </TabsList>

        {/* 文件上传 */}
        <TabsContent value="upload" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>上传文件</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="toChat">目标聊天</Label>
                    <Input
                      id="toChat"
                      value={toChat}
                      onChange={(e) => setToChat(e.target.value)}
                      placeholder="输入目标聊天ID、用户名或@username（留空或输入me上传到自己）"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      例如：@username、1234567890、me（上传到自己）。留空或输入"me"会上传到收藏夹（Saved Messages）
                    </p>
                  </div>
                  
                  <div>
                    <Label htmlFor="excludes">排除文件扩展名（可选）</Label>
                    <Input
                      id="excludes"
                      value={excludes}
                      onChange={(e) => setExcludes(e.target.value)}
                      placeholder="例如：.tmp,.log,.bak（用逗号分隔）"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      指定要排除的文件扩展名，用逗号分隔
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-3">
                    <Label>上传选项</Label>
                    <div className="space-y-2">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={photo}
                          onChange={(e) => setPhoto(e.target.checked)}
                        />
                        <span className="text-sm">作为照片上传（仅适用于图片文件）</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={remove}
                          onChange={(e) => setRemove(e.target.checked)}
                        />
                        <span className="text-sm">上传后删除本地文件</span>
                      </label>
                    </div>
                    <div className="text-xs text-muted-foreground mt-2 p-2 bg-muted/50 rounded">
                      <p>📝 上传说明：</p>
                      <p>• 作为照片：图片将显示在聊天中，支持预览</p>
                      <p>• 作为文件：保持原始格式，支持所有文件类型</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* 文件选择区域 */}
              <div className="space-y-4">
                <div>
                  <Label>选择文件</Label>
                  <div
                    className={`mt-2 border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                      isDragging 
                        ? 'border-blue-400 bg-blue-50' 
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                      id="file-upload"
                    />
                    <div className="space-y-2">
                      <div className="text-4xl">📁</div>
                      <div>
                        <p className="text-lg font-medium">拖放文件到这里</p>
                        <p className="text-sm text-muted-foreground">或者</p>
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={() => fileInputRef.current?.click()}
                          className="mt-2"
                        >
                          选择文件
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 已选择的文件列表 */}
                {selectedFiles && selectedFiles.length > 0 && (
                  <div>
                    <Label>已选择的文件 ({selectedFiles.length} 个)</Label>
                    <div className="mt-2 space-y-2 max-h-32 overflow-y-auto border rounded p-2">
                      {Array.from(selectedFiles).map((file, index) => (
                        <div key={index} className="flex items-center justify-between text-sm">
                          <span className="truncate">{file.name}</span>
                          <span className="text-muted-foreground ml-2 flex-shrink-0">
                            {formatFileSize(file.size)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      总大小: {formatFileSize(Array.from(selectedFiles).reduce((total, file) => total + file.size, 0))}
                    </div>
                  </div>
                )}
              </div>

              <Button 
                onClick={handleStartUpload} 
                className="w-full"
                disabled={loading || !selectedFiles || selectedFiles.length === 0}
              >
                {loading ? '上传中...' : '开始上传'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 任务管理 */}
        <TabsContent value="tasks" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>上传任务</CardTitle>
                <Button 
                  variant="outline" 
                  onClick={fetchUploadTasks}
                  disabled={tasksLoading}
                >
                  {tasksLoading ? '刷新中...' : '刷新'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无上传任务
                </div>
              ) : (
                <div className="space-y-4">
                  {tasks.map((task) => {
                    const statusInfo = formatTaskStatus(task.status)
                    return (
                      <div key={task.id} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{task.name}</h3>
                              <Badge variant={statusInfo.variant as any}>
                                {statusInfo.text}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              任务ID: {task.id}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {(task.status === 'running' || task.status === 'pending') && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCancelTask(task.id)}
                              >
                                取消
                              </Button>
                            )}
                          </div>
                        </div>

                        {task.status === 'running' && (
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span>进度: {task.uploaded}/{task.total}</span>
                              <span>{task.speed}</span>
                            </div>
                            <Progress value={task.progress} className="w-full" />
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">目标: </span>
                            {task.to_chat || '收藏夹 (Saved Messages)'}
                          </div>
                          <div>
                            <span className="text-muted-foreground">文件数量: </span>
                            {task.total}
                          </div>
                        </div>

                        <div className="flex justify-between text-sm">
                          <span>已上传: {task.uploaded}</span>
                          <span>失败: {task.failed}</span>
                          <span>创建时间: {new Date(task.created_at).toLocaleString()}</span>
                        </div>

                        {task.error && (
                          <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                            错误: {task.error}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default UploadPage