import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { api } from '@/utils/api'

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
}

interface ChatUsersRequest {
  chat: string
  raw?: boolean
}

const ChatPage = () => {
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('true')
  const [selectedChat, setSelectedChat] = useState<Dialog | null>(null)
  const { toast } = useToast()

  // Export form states
  const [exportType, setExportType] = useState<'time' | 'id' | 'last'>('last')
  const [exportInput, setExportInput] = useState<string>('100')
  const [exportChat, setExportChat] = useState('')
  const [exportThread, setExportThread] = useState('')
  const [exportFilter, setExportFilter] = useState('true')
  const [withContent, setWithContent] = useState(false)
  const [allMessages, setAllMessages] = useState(false)

  // Users export states
  const [usersChat, setUsersChat] = useState('')

  useEffect(() => {
    fetchChatList()
  }, [])

  const fetchChatList = async () => {
    try {
      setLoading(true)
      const response = await api.get('/api/v1/chat/list', {
        params: { filter, output: 'json' }
      })
      
      if (response.data.success) {
        setDialogs(response.data.data)
      } else {
        toast({
          title: '获取聊天列表失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
    } catch (error: any) {
      toast({
        title: '获取聊天列表失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
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
      all: allMessages
    }

    if (exportThread) {
      request.thread = parseInt(exportThread)
    }

    try {
      const response = await api.post('/api/v1/chat/export', request)
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
      chat: usersChat
    }

    try {
      const response = await api.post('/api/v1/chat/users', request)
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

      <Tabs defaultValue="list" className="space-y-4">
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
              <div className="flex gap-4">
                <div className="flex-1">
                  <Label htmlFor="filter">过滤表达式</Label>
                  <Input
                    id="filter"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="输入过滤条件（例如：Type == 'private'）"
                  />
                </div>
                <div className="flex items-end">
                  <Button onClick={fetchChatList} disabled={loading}>
                    {loading ? '加载中...' : '刷新'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">ID</th>
                      <th className="text-left p-2">类型</th>
                      <th className="text-left p-2">名称</th>
                      <th className="text-left p-2">用户名</th>
                      <th className="text-left p-2">主题</th>
                      <th className="text-left p-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dialogs.map((dialog) => (
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
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => {
                              setSelectedChat(dialog)
                              setExportChat(dialog.username || dialog.id.toString())
                              setUsersChat(dialog.username || dialog.id.toString())
                            }}
                          >
                            选择
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dialogs.length === 0 && !loading && (
                  <div className="text-center py-8 text-muted-foreground">
                    暂无聊天数据
                  </div>
                )}
              </div>
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