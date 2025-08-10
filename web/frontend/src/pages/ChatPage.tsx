import { useState, useEffect, useRef } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { ApiService } from '@/utils/api'

interface Dialog {
  id: number
  type: string
  visible_name: string
  username: string
  topics?: Topic[]
}

interface Topic {
  id: number
  title: string
}

interface ChatExportRequest {
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
}

interface ChatUsersRequest {
  chat: string
  raw?: boolean
  output_path?: string
}

const ChatPage = () => {
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('true')
  const [selectedChat, setSelectedChat] = useState<Dialog | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const { toast } = useToast()

  // Export form states
  const [exportType, setExportType] = useState<'time' | 'id' | 'last'>('last')
  const [exportInput, setExportInput] = useState<string>('100')
  const [exportChat, setExportChat] = useState('')
  const [exportThread, setExportThread] = useState('')
  const [exportFilter, setExportFilter] = useState('true')
  const [withContent, setWithContent] = useState(false)
  const [allMessages, setAllMessages] = useState(false)
  const [exportOutputPath, setExportOutputPath] = useState('')

  // Users export states
  const [usersChat, setUsersChat] = useState('')
  const [usersOutputPath, setUsersOutputPath] = useState('')
  
  // 默认下载路径
  const [defaultPath, setDefaultPath] = useState('')
  const [pathLoading, setPathLoading] = useState(false)
  
  // Tab状态管理
  const [activeTab, setActiveTab] = useState('list')
  
  // 用于跟踪是否是首次渲染和防重复调用
  const isFirstRender = useRef(true)
  const hasInitialized = useRef(false)
  const fetchChatListLock = useRef(false) // 专门用于fetchChatList的锁
  const [initialized, setInitialized] = useState(false)

  // 优化初始化逻辑，使用独立的状态管理
  useEffect(() => {
    const initializePage = async () => {
      // 防止React.StrictMode重复调用
      if (hasInitialized.current) {
        return
      }
      
      hasInitialized.current = true
      
      try {
        // 先获取默认路径（非阻塞）
        fetchDefaultPath().catch(err => {
          console.warn('获取默认路径失败，将使用空值:', err)
        })
        
        // 再获取聊天列表（主要功能）- 不使用全局loading锁
        await fetchChatList(1, '')
        setInitialized(true)
      } catch (error) {
        console.error('页面初始化失败:', error)
        setInitialized(true) // 即使失败也标记为已初始化
      }
    }
    
    initializePage()
  }, [])

  const fetchDefaultPath = async () => {
    try {
      setPathLoading(true)
      const response = await ApiService.getDefaultDownloadPath()
      if (response.data.success) {
        const path = response.data.data.default_path
        setDefaultPath(path)
        // 设置默认路径为默认值
        setExportOutputPath(path)
        setUsersOutputPath(path)
      }
    } catch (error: any) {
      // 降低错误级别，不显示toast，避免影响主要功能
      console.warn('获取默认下载路径失败，将使用系统默认值:', error.response?.data?.message || error.message)
      // 设置一个合理的默认值
      const fallbackPath = 'C:\\Downloads' // Simplified fallback path
      setDefaultPath(fallbackPath)
      setExportOutputPath(fallbackPath)
      setUsersOutputPath(fallbackPath)
    } finally {
      setPathLoading(false)
    }
  }

  // 搜索防抖 - 移除initialized依赖项，避免重复触发
  useEffect(() => {
    // 跳过首次渲染
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    
    // 只有在已初始化时才执行搜索
    if (!initialized) {
      return
    }
    
    const timer = setTimeout(() => {
      setCurrentPage(1)
      fetchChatList(1, searchTerm)
    }, 500)
    
    return () => clearTimeout(timer)
  }, [searchTerm]) // 移除initialized依赖项

  const fetchChatList = async (page: number = currentPage, search: string = searchTerm) => {
    // 使用专门的锁防止fetchChatList重复调用
    if (fetchChatListLock.current) {
      console.log('fetchChatList调用已在进行中，跳过重复请求')
      return
    }
    
    try {
      fetchChatListLock.current = true
      setLoading(true)
      const response = await ApiService.getChatList({
        filter,
        output: 'json',
        page,
        limit: pageSize,
        search: search.trim() || undefined
      })
      
      if (response.data.success) {
        // 确保 data.data 是数组，如果不是则使用空数组
        const dialogsData = Array.isArray(response.data.data.data) ? response.data.data.data : []
        setDialogs(dialogsData)
        setTotalCount(response.data.data.total_count || 0)
        setTotalPages(response.data.data.total_pages || 1)
        setCurrentPage(response.data.data.page || page) // 使用传入的page参数
      } else {
        // API 调用成功但业务逻辑失败，确保 dialogs 为空数组
        setDialogs([])
        setTotalCount(0)
        setTotalPages(1)
        setCurrentPage(1)
        toast({
          title: '获取聊天列表失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      // 发生异常时确保 dialogs 为空数组
      setDialogs([])
      setTotalCount(0)
      setTotalPages(1)
      setCurrentPage(1)
      
      // 根据错误类型提供不同的处理
      const errorMessage = error.response?.data?.message || error.message || '网络错误'
      console.error('获取聊天列表失败:', errorMessage, error)
      
      // 只有在非认证错误时才显示toast
      if (!errorMessage.includes('authorized') && !errorMessage.includes('login')) {
        toast({
          title: '获取聊天列表失败',
          description: errorMessage,
          variant: 'destructive'
        })
      }
    } finally {
      setLoading(false)
      fetchChatListLock.current = false
    }
  }

  const handlePageChange = (page: number) => {
    if (loading || fetchChatListLock.current) return // 防止重复请求
    
    setCurrentPage(page)
    fetchChatList(page, searchTerm)
  }

  const handlePageSizeChange = (size: number) => {
    if (loading || fetchChatListLock.current) return // 防止重复请求
    
    setPageSize(size)
    setCurrentPage(1)
    fetchChatList(1, searchTerm)
  }

  const handleExportMessages = async () => {
    if (!exportChat.trim()) {
      toast({
        title: '导出失败',
        description: '请输入聊天ID或用户名',
        variant: 'destructive'
      })
      return
    }

    // Parse input based on export type
    let inputArray: number[]
    try {
      if (exportType === 'last') {
        inputArray = [parseInt(exportInput)]
      } else {
        // time or id - expect comma-separated values
        const parts = exportInput.split(',').map(s => parseInt(s.trim()))
        if (parts.length === 1) {
          // If only one value provided, use it as start and set end to max
          inputArray = [parts[0], Math.floor(Date.now() / 1000)]
        } else {
          inputArray = parts
        }
      }
    } catch (error) {
      toast({
        title: '输入格式错误',
        description: '请输入有效的数字',
        variant: 'destructive'
      })
      return
    }

    const request: ChatExportRequest = {
      type: exportType,
      chat: exportChat,
      input: inputArray,
      filter: exportFilter,
      with_content: withContent,
      all: allMessages,
      output_path: exportOutputPath || undefined
    }

    if (exportThread) {
      request.thread = parseInt(exportThread)
    }

    try {
      const response = await ApiService.exportChatMessages(request)
      if (response.data.success) {
        toast({
          title: '导出任务已提交',
          description: `任务ID: ${response.data.task_id}`
        })
      } else {
        toast({
          title: '导出失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: '导出失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    }
  }

  const handleExportUsers = async () => {
    if (!usersChat.trim()) {
      toast({
        title: '导出失败',
        description: '请输入聊天ID或用户名',
        variant: 'destructive'
      })
      return
    }

    const request: ChatUsersRequest = {
      chat: usersChat,
      output_path: usersOutputPath || undefined
    }

    try {
      const response = await ApiService.exportChatUsers(request)
      if (response.data.success) {
        toast({
          title: '用户导出任务已提交',
          description: `任务ID: ${response.data.task_id}`
        })
      } else {
        toast({
          title: '导出失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: '导出失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    }
  }

  const formatDialogType = (type: string) => {
    switch (type) {
      case 'private': return '私聊'
      case 'group': return '群组'
      case 'channel': return '频道'
      default: return type
    }
  }

  const formatTopics = (topics?: Topic[]) => {
    if (!topics || topics.length === 0) return '-'
    return topics.map(t => `${t.id}: ${t.title}`).join(', ')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">聊天管理</h1>
        <p className="text-muted-foreground">
          管理您的Telegram聊天，导出消息和用户数据
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="list">聊天列表</TabsTrigger>
          <TabsTrigger value="export">导出消息</TabsTrigger>
          <TabsTrigger value="users">导出用户</TabsTrigger>
        </TabsList>

        {/* 聊天列表 */}
        <TabsContent value="list" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>聊天列表</CardTitle>
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label htmlFor="search">搜索聊天</Label>
                    <Input
                      id="search"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="搜索名称、用户名或ID..."
                    />
                  </div>
                  <div className="flex-1">
                    <Label htmlFor="filter">过滤表达式</Label>
                    <Input
                      id="filter"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="输入过滤条件（例如：Type == 'private'）"
                    />
                  </div>
                  <div className="w-24">
                    <Label htmlFor="pageSize">每页条数</Label>
                    <select
                      id="pageSize"
                      value={pageSize}
                      onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                      className="w-full p-2 border rounded-md"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={() => fetchChatList(currentPage, searchTerm)} disabled={loading}>
                      {loading ? '加载中...' : '刷新'}
                    </Button>
                  </div>
                </div>
                <div className="flex justify-between items-center text-sm text-muted-foreground">
                  <span>共 {totalCount} 条记录，第 {currentPage} / {totalPages} 页</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">ID</th>
                      <th className="text-left p-2 w-20">类型</th>
                      <th className="text-left p-2">名称</th>
                      <th className="text-left p-2">用户名</th>
                      <th className="text-left p-2">主题</th>
                      <th className="text-left p-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.isArray(dialogs) && dialogs.map((dialog) => (
                      <tr key={dialog.id} className="border-b hover:bg-muted/50">
                        <td className="p-2 font-mono text-sm">{dialog.id}</td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${
                            dialog.type === 'private' ? 'bg-blue-100 text-blue-800' :
                            dialog.type === 'group' ? 'bg-green-100 text-green-800' :
                            'bg-purple-100 text-purple-800'
                          }`}>
                            {formatDialogType(dialog.type)}
                          </span>
                        </td>
                        <td className="p-2">{dialog.visible_name || '-'}</td>
                        <td className="p-2 font-mono text-sm">{dialog.username || '-'}</td>
                        <td className="p-2 text-sm">{formatTopics(dialog.topics)}</td>
                        <td className="p-2">
                          <div className="flex gap-1">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setSelectedChat(dialog)
                                setExportChat(dialog.username || dialog.id.toString())
                                setActiveTab('export') // 跳转到导出消息标签页
                              }}
                            >
                              导出消息
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setSelectedChat(dialog)
                                setUsersChat(dialog.username || dialog.id.toString())
                                setActiveTab('users') // 跳转到导出用户标签页
                              }}
                            >
                              导出用户
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!Array.isArray(dialogs) || dialogs.length === 0) && !loading && (
                  <div className="text-center py-8 text-muted-foreground">
                    {searchTerm ? '未找到匹配的聊天' : '暂无聊天数据'}
                  </div>
                )}
              </div>
              
              {/* 分页控件 */}
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    显示第 {((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalCount)} 条，共 {totalCount} 条
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handlePageChange(1)}
                      disabled={currentPage === 1 || loading}
                    >
                      首页
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1 || loading}
                    >
                      上一页
                    </Button>
                    <span className="px-3 py-1 text-sm">
                      {currentPage} / {totalPages}
                    </span>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages || loading}
                    >
                      下一页
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handlePageChange(totalPages)}
                      disabled={currentPage === totalPages || loading}
                    >
                      末页
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 导出消息 */}
        <TabsContent value="export" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>导出聊天消息</CardTitle>
              {selectedChat && (
                <p className="text-sm text-muted-foreground">
                  当前选择: {selectedChat.visible_name} (@{selectedChat.username || selectedChat.id})
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="exportChat">聊天ID或用户名</Label>
                  <Input
                    id="exportChat"
                    value={exportChat}
                    onChange={(e) => setExportChat(e.target.value)}
                    placeholder="输入聊天ID或@username"
                  />
                </div>
                <div>
                  <Label htmlFor="exportThread">主题/回复ID (可选)</Label>
                  <Input
                    id="exportThread"
                    value={exportThread}
                    onChange={(e) => setExportThread(e.target.value)}
                    placeholder="输入主题ID或消息ID"
                    type="number"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="exportType">导出类型</Label>
                  <select 
                    id="exportType"
                    value={exportType}
                    onChange={(e) => setExportType(e.target.value as any)}
                    className="w-full p-2 border rounded-md"
                  >
                    <option value="last">最近N条</option>
                    <option value="id">消息ID范围</option>
                    <option value="time">时间范围</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="exportInput">
                    {exportType === 'last' ? '消息数量' : 
                     exportType === 'id' ? 'ID范围 (start,end)' : 
                     '时间戳范围 (start,end)'}
                  </Label>
                  <Input
                    id="exportInput"
                    value={exportInput}
                    onChange={(e) => setExportInput(e.target.value)}
                    placeholder={
                      exportType === 'last' ? '100' :
                      exportType === 'id' ? '1,1000' :
                      '1609459200,1640995200'
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="exportFilter">过滤条件</Label>
                  <Input
                    id="exportFilter"
                    value={exportFilter}
                    onChange={(e) => setExportFilter(e.target.value)}
                    placeholder="过滤表达式"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="exportOutputPath">下载路径</Label>
                  <Input
                    id="exportOutputPath"
                    value={exportOutputPath}
                    onChange={(e) => setExportOutputPath(e.target.value)}
                    placeholder={pathLoading ? '加载中...' : defaultPath || '请输入下载路径'}
                    disabled={pathLoading}
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    默认路径: {defaultPath || '未知'}
                  </p>
                </div>
                
                <div className="flex gap-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={withContent}
                      onChange={(e) => setWithContent(e.target.checked)}
                    />
                    <span>包含消息内容</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={allMessages}
                      onChange={(e) => setAllMessages(e.target.checked)}
                    />
                    <span>导出所有消息</span>
                  </label>
                </div>
              </div>

              <Button onClick={handleExportMessages} className="w-full">
                开始导出消息
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 导出用户 */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>导出聊天用户</CardTitle>
              {selectedChat && (
                <p className="text-sm text-muted-foreground">
                  当前选择: {selectedChat.visible_name} (@{selectedChat.username || selectedChat.id})
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="usersChat">聊天ID或用户名</Label>
                <Input
                  id="usersChat"
                  value={usersChat}
                  onChange={(e) => setUsersChat(e.target.value)}
                  placeholder="输入频道/群组的ID或@username"
                />
                <p className="text-sm text-muted-foreground mt-1">
                  只支持频道和群组，不支持私聊
                </p>
              </div>
              
              <div>
                <Label htmlFor="usersOutputPath">下载路径</Label>
                <Input
                  id="usersOutputPath"
                  value={usersOutputPath}
                  onChange={(e) => setUsersOutputPath(e.target.value)}
                  placeholder={pathLoading ? '加载中...' : defaultPath || '请输入下载路径'}
                  disabled={pathLoading}
                />
                <p className="text-sm text-muted-foreground mt-1">
                  默认路径: {defaultPath || '未知'}
                </p>
              </div>

              <Button onClick={handleExportUsers} className="w-full">
                开始导出用户
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default ChatPage