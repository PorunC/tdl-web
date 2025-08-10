import { useState, useEffect, useRef } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/components/ui/use-toast'
import { ApiService } from '@/utils/api'

interface ForwardRequest {
  from_sources: string[]
  to_chat: string
  edit_text?: string
  mode?: string
  silent?: boolean
  dry_run?: boolean
  single?: boolean
  desc?: boolean
  task_id?: string
}

interface ForwardTask {
  id: string
  type: string
  name: string
  status: string
  progress: number
  speed: string
  eta: string
  forwarded: number
  total: number
  failed: number
  created_at: string
  error?: string
  from_sources: string[]
  to_chat: string
  message_stats: MessageStat[]
}

interface MessageStat {
  from_chat: string
  message_id: number
  to_chat: string
  status: string
  error?: string
  forwarded_at?: string
}

const ForwardPage = () => {
  const [activeTab, setActiveTab] = useState('create')
  const { toast } = useToast()

  // 创建转发表单状态
  const [fromSources, setFromSources] = useState<string>('')
  const [toChat, setToChat] = useState('')
  const [editText, setEditText] = useState('')
  const [forwardMode, setForwardMode] = useState('direct')
  const [silent, setSilent] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [single, setSingle] = useState(false)
  const [desc, setDesc] = useState(false)

  // 任务管理状态
  const [tasks, setTasks] = useState<ForwardTask[]>([])
  const [loading, setLoading] = useState(false)
  const [tasksLoading, setTasksLoading] = useState(false)
  
  // 用于跟踪是否是首次渲染
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
        await fetchForwardTasks()
        setInitialized(true)
      } catch (error) {
        console.error('页面初始化失败:', error)
        setInitialized(true)
      }
    }
    
    initializePage()
  }, [])

  // 获取转发任务列表
  const fetchForwardTasks = async () => {
    try {
      setTasksLoading(true)
      const response = await ApiService.getForwardTasks()
      
      if (response.data.success) {
        setTasks(response.data.data.tasks || [])
      } else {
        toast({
          title: '获取转发任务失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      console.error('获取转发任务失败:', error)
      const errorMessage = error.response?.data?.message || error.message || '网络错误'
      
      if (!errorMessage.includes('authorized') && !errorMessage.includes('login')) {
        toast({
          title: '获取转发任务失败',
          description: errorMessage,
          variant: 'destructive'
        })
      }
    } finally {
      setTasksLoading(false)
    }
  }

  // 开始转发任务
  const handleStartForward = async () => {
    if (!fromSources.trim()) {
      toast({
        title: '转发失败',
        description: '请输入消息来源（文件路径或URL）',
        variant: 'destructive'
      })
      return
    }


    const sourcesArray = fromSources.split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0)

    if (sourcesArray.length === 0) {
      toast({
        title: '转发失败',
        description: '请输入有效的消息来源',
        variant: 'destructive'
      })
      return
    }

    // 处理目标聊天：空字符串或"me"都表示转发到Saved Messages
    const targetChat = toChat.trim()
    const finalToChat = targetChat === '' || targetChat.toLowerCase() === 'me' ? '' : targetChat

    const request: ForwardRequest = {
      from_sources: sourcesArray,
      to_chat: finalToChat,
      edit_text: editText.trim() || undefined,
      mode: forwardMode,
      silent,
      dry_run: dryRun,
      single,
      desc,
      task_id: `forward_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    }

    try {
      setLoading(true)
      const response = await ApiService.startForward(request)
      
      if (response.data.success) {
        toast({
          title: '转发任务已提交',
          description: `任务ID: ${response.data.data.task_id}`
        })
        
        // 清空表单
        setFromSources('')
        setToChat('')
        setEditText('')
        
        // 刷新任务列表并切换到任务管理标签
        await fetchForwardTasks()
        setActiveTab('tasks')
      } else {
        toast({
          title: '转发失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: '转发失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  // 取消转发任务
  const handleCancelTask = async (taskId: string) => {
    try {
      const response = await ApiService.cancelForwardTask(taskId)
      
      if (response.data.success) {
        toast({
          title: '任务已取消',
          description: '转发任务已成功取消'
        })
        await fetchForwardTasks()
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
      case 'running': return { text: '转发中', variant: 'default' }
      case 'completed': return { text: '已完成', variant: 'secondary' }
      case 'cancelled': return { text: '已取消', variant: 'outline' }
      case 'error': return { text: '失败', variant: 'destructive' }
      default: return { text: status, variant: 'secondary' }
    }
  }

  // 格式化转发模式
  const formatForwardMode = (mode: string) => {
    switch (mode) {
      case 'direct': return '直接转发'
      case 'clone': return '克隆转发'
      default: return mode
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">转发管理</h1>
        <p className="text-muted-foreground">
          转发Telegram消息到其他聊天，支持批量转发和消息编辑
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="create">创建转发</TabsTrigger>
          <TabsTrigger value="tasks">任务管理</TabsTrigger>
        </TabsList>

        {/* 创建转发任务 */}
        <TabsContent value="create" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>创建转发任务</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="fromSources">消息来源</Label>
                    <Textarea
                      id="fromSources"
                      value={fromSources}
                      onChange={(e) => setFromSources(e.target.value)}
                      placeholder="输入JSON文件路径或消息链接，每行一个：&#10;/path/to/messages.json&#10;https://t.me/channel/123&#10;chat_export.json"
                      className="min-h-[120px]"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      支持JSON文件路径或Telegram消息链接，每行一个来源
                    </p>
                  </div>
                  
                  <div>
                    <Label htmlFor="toChat">目标聊天</Label>
                    <Input
                      id="toChat"
                      value={toChat}
                      onChange={(e) => setToChat(e.target.value)}
                      placeholder="输入目标聊天ID、用户名或@username（留空或输入me转发给自己）"
                    />
                    <p className="text-sm text-muted-foreground mt-1">
                      例如：@username、1234567890、me（转发给自己）。留空或输入"me"会转发到收藏夹（Saved Messages）
                    </p>
                  </div>
                  
                  <div>
                    <Label htmlFor="editText">
                      编辑消息（可选）
                      {forwardMode === 'clone' && (
                        <span className="ml-1 text-green-600">• 克隆模式推荐</span>
                      )}
                    </Label>
                    <Textarea
                      id="editText"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      placeholder={
                        forwardMode === 'clone' 
                          ? "克隆模式：输入新的消息内容替换原文，支持HTML格式和表达式..."
                          : "直接转发模式下此功能将自动切换为克隆模式..."
                      }
                      rows={3}
                      className={forwardMode === 'clone' ? 'border-green-200 focus:border-green-400' : ''}
                    />
                    <div className="mt-1 space-y-1">
                      <p className="text-sm text-muted-foreground">
                        {forwardMode === 'clone' ? (
                          <span>如果填写，将完全替换原消息内容。支持HTML标签和表达式变量</span>
                        ) : (
                          <span className="text-amber-600">
                            ⚠️ 注意：填写编辑内容将自动切换为克隆模式以支持消息编辑
                          </span>
                        )}
                      </p>
                      {editText && forwardMode === 'direct' && (
                        <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded">
                          由于填写了编辑内容，转发时将自动使用克隆模式
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="forwardMode">转发模式</Label>
                    <Select value={forwardMode} onValueChange={setForwardMode}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择转发模式">
                          {forwardMode === 'direct' && "直接转发 (Direct)"}
                          {forwardMode === 'clone' && "克隆转发 (Clone)"}
                          {!forwardMode && "选择转发模式"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">直接转发 (Direct)</SelectItem>
                        <SelectItem value="clone">克隆转发 (Clone)</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    {/* 模式说明卡片 */}
                    <div className="mt-2 p-3 bg-muted/50 rounded-md border">
                      {forwardMode === 'direct' ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                            <h4 className="font-medium text-blue-700">直接转发模式</h4>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            保持原消息引用，显示"已转发"标签，转发速度快
                          </p>
                          <div className="text-xs text-muted-foreground space-y-1 pl-4 border-l-2 border-blue-200">
                            <p>✅ 转发速度快，消耗资源少</p>
                            <p>✅ 保持原消息的"转发自"信息</p>
                            <p>❌ 不支持编辑消息内容</p>
                            <p>🎯 适合公开频道和群组转发</p>
                          </div>
                        </div>
                      ) : forwardMode === 'clone' ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <h4 className="font-medium text-green-700">克隆转发模式</h4>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            创建新消息副本，可编辑内容，不显示转发来源
                          </p>
                          <div className="text-xs text-muted-foreground space-y-1 pl-4 border-l-2 border-green-200">
                            <p>✅ 创建完全独立的新消息</p>
                            <p>✅ 支持编辑消息文本和格式</p>
                            <p>✅ 不显示原消息来源</p>
                            <p>🎯 适合私密转发和内容二次编辑</p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                            <h4 className="font-medium text-gray-700">请选择转发模式</h4>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            选择一种转发模式来查看详细说明和特性对比
                          </p>
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="p-2 border border-blue-200 rounded text-center cursor-pointer hover:bg-blue-50" 
                                 onClick={() => setForwardMode('direct')}>
                              <p className="text-xs font-medium text-blue-600">直接转发</p>
                              <p className="text-xs text-muted-foreground">快速转发</p>
                            </div>
                            <div className="p-2 border border-green-200 rounded text-center cursor-pointer hover:bg-green-50"
                                 onClick={() => setForwardMode('clone')}>
                              <p className="text-xs font-medium text-green-600">克隆转发</p>
                              <p className="text-xs text-muted-foreground">可编辑内容</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label>转发选项</Label>
                    <div className="space-y-2">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={silent}
                          onChange={(e) => setSilent(e.target.checked)}
                        />
                        <span className="text-sm">静默转发（不发送通知）</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={dryRun}
                          onChange={(e) => setDryRun(e.target.checked)}
                        />
                        <span className="text-sm">测试模式（仅预览不实际转发）</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={single}
                          onChange={(e) => setSingle(e.target.checked)}
                        />
                        <span className="text-sm">逐个转发（不分组发送）</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={desc}
                          onChange={(e) => setDesc(e.target.checked)}
                        />
                        <span className="text-sm">倒序转发（从新到旧）</span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <Button 
                onClick={handleStartForward} 
                className="w-full"
                disabled={loading}
              >
                {loading ? '创建中...' : '开始转发'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 任务管理 */}
        <TabsContent value="tasks" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>转发任务</CardTitle>
                <Button 
                  variant="outline" 
                  onClick={fetchForwardTasks}
                  disabled={tasksLoading}
                >
                  {tasksLoading ? '刷新中...' : '刷新'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无转发任务
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
                              <span>进度: {task.forwarded}/{task.total}</span>
                              <span>{task.speed}</span>
                            </div>
                            <Progress value={task.progress} className="w-full" />
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">来源: </span>
                            {task.from_sources.join(', ')}
                          </div>
                          <div>
                            <span className="text-muted-foreground">目标: </span>
                            {task.to_chat}
                          </div>
                        </div>

                        <div className="flex justify-between text-sm">
                          <span>已转发: {task.forwarded}</span>
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

export default ForwardPage