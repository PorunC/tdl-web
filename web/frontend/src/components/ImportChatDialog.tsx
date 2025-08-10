import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { useTaskStore, Task, DownloadConfig, ChatInfo } from '@/store/taskStore'
import { useDownloadStore } from '@/store/downloadStore'
import { ApiService } from '@/utils/api'
import { 
  Upload, 
  FileText, 
  Image, 
  Video, 
  FileAudio, 
  File,
  CheckSquare,
  Square,
  Download,
  AlertCircle,
  Info
} from 'lucide-react'

interface ImportChatDialogProps {
  trigger?: React.ReactNode
}

interface MediaMessage {
  id: number
  type: 'photo' | 'document' | 'video' | 'audio' | 'voice' | 'sticker'
  filename: string
  fileSize?: number
  date?: number
  selected: boolean
}

interface ImportedChatData {
  chatId: number
  chatTitle?: string
  totalMessages: number
  mediaMessages: MediaMessage[]
  hasValidStructure: boolean
}

export function ImportChatDialog({ trigger }: ImportChatDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [downloadPath, setDownloadPath] = useState('')
  const [template, setTemplate] = useState('')
  const [onlySelected, setOnlySelected] = useState(false)
  const [importData, setImportData] = useState<ImportedChatData | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const { addTask } = useTaskStore()
  const { settings, loadSettings } = useDownloadStore()

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Set defaults from settings
  useEffect(() => {
    if (!downloadPath) {
      setDownloadPath(settings.defaultPath || './downloads')
    }
    if (!template) {
      setTemplate(settings.defaultTemplate || '{DialogID}_{MessageID}_{FileName}')
    }
  }, [settings, downloadPath, template])

  const getFileTypeIcon = (type: string) => {
    switch (type) {
      case 'photo': return <Image className="h-4 w-4 text-green-600" />
      case 'video': return <Video className="h-4 w-4 text-blue-600" />
      case 'document': return <FileText className="h-4 w-4 text-purple-600" />
      case 'audio':
      case 'voice': return <FileAudio className="h-4 w-4 text-orange-600" />
      default: return <File className="h-4 w-4 text-gray-600" />
    }
  }

  const parseJsonFile = async (file: File): Promise<ImportedChatData> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string
          const data = JSON.parse(content)
          
          // Validate JSON structure
          if (!data.id || !Array.isArray(data.messages)) {
            throw new Error('Invalid JSON format: missing required fields')
          }
          
          const chatId = typeof data.id === 'number' ? data.id : parseInt(data.id)
          if (isNaN(chatId)) {
            throw new Error('Invalid chat ID in JSON file')
          }
          
          // Extract media messages
          const mediaMessages: MediaMessage[] = []
          
          data.messages.forEach((msg: any) => {
            if (!msg.id || msg.type !== 'message') return
            
            // Check for media content
            let hasMedia = false
            let mediaType = 'document'
            let filename = ''
            
            if (msg.file && typeof msg.file === 'string' && msg.file.trim()) {
              hasMedia = true
              filename = msg.file
              // Determine type from filename extension
              const ext = filename.split('.').pop()?.toLowerCase()
              if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) {
                mediaType = 'photo'
              } else if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext || '')) {
                mediaType = 'video'
              } else if (['mp3', 'wav', 'flac', 'ogg', 'm4a'].includes(ext || '')) {
                mediaType = 'audio'
              }
            } else if (msg.photo && typeof msg.photo === 'string' && msg.photo.trim()) {
              hasMedia = true
              mediaType = 'photo'
              filename = msg.photo
            }
            
            if (hasMedia) {
              mediaMessages.push({
                id: msg.id,
                type: mediaType as any,
                filename,
                fileSize: msg.file_size || undefined,
                date: msg.date || undefined,
                selected: true // Default to selected
              })
            }
          })
          
          resolve({
            chatId,
            chatTitle: data.title || `Chat ${chatId}`,
            totalMessages: data.messages.length,
            mediaMessages,
            hasValidStructure: true
          })
          
        } catch (error) {
          reject(new Error(`JSON parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`))
        }
      }
      
      reader.onerror = () => {
        reject(new Error('Failed to read file'))
      }
      
      reader.readAsText(file)
    })
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.json')) {
      toast({
        title: '文件格式错误',
        description: '请选择JSON格式的聊天导出文件',
        variant: 'destructive'
      })
      return
    }

    try {
      setAnalyzing(true)
      const importData = await parseJsonFile(file)
      setImportData(importData)
      
      toast({
        title: '文件解析成功',
        description: `找到 ${importData.mediaMessages.length} 个媒体文件`
      })
    } catch (error: any) {
      toast({
        title: '文件解析失败',
        description: error.message,
        variant: 'destructive'
      })
      setImportData(null)
    } finally {
      setAnalyzing(false)
    }
  }

  const toggleSelectAll = () => {
    if (!importData) return
    
    const allSelected = importData.mediaMessages.every(msg => msg.selected)
    setImportData({
      ...importData,
      mediaMessages: importData.mediaMessages.map(msg => ({
        ...msg,
        selected: !allSelected
      }))
    })
  }

  const toggleMessageSelect = (messageId: number) => {
    if (!importData) return
    
    setImportData({
      ...importData,
      mediaMessages: importData.mediaMessages.map(msg =>
        msg.id === messageId ? { ...msg, selected: !msg.selected } : msg
      )
    })
  }

  const handleStartDownload = async () => {
    if (!importData) return
    
    const selectedMessages = importData.mediaMessages.filter(msg => msg.selected)
    if (selectedMessages.length === 0) {
      toast({
        title: '请选择文件',
        description: '请至少选择一个媒体文件进行下载',
        variant: 'destructive'
      })
      return
    }

    if (!downloadPath.trim()) {
      toast({
        title: '路径错误',
        description: '请设置下载路径',
        variant: 'destructive'
      })
      return
    }

    try {
      setLoading(true)

      // Create download task
      const chatInfo: ChatInfo = {
        id: importData.chatId.toString(),
        title: importData.chatTitle || `Chat ${importData.chatId}`,
        type: 'channel' // Default type for imports
      }

      const downloadConfig: DownloadConfig = {
        urls: [], // No URLs for JSON import
        files: [], // Will be handled by backend
        fileTypes: [],
        filter: 'true',
        downloadPath: downloadPath.trim(),
        template: template.trim() || settings.defaultTemplate,
        takeout: false,
        continue: true,
        desc: false
      }

      const task: Task = {
        id: `import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'download',
        name: `导入下载: ${importData.chatTitle} (${selectedMessages.length}个文件)`,
        status: 'pending',
        progress: 0,
        speed: '0 B/s',
        eta: '--',
        transferred: 0,
        total: 0,
        createdAt: new Date().toISOString(),
        chatInfo,
        downloadConfig,
        resumable: true,
        statistics: {
          filesTotal: selectedMessages.length,
          filesCompleted: 0,
          filesSkipped: 0,
          filesFailed: 0,
          errors: []
        }
      }

      // Add to store first
      addTask(task)

      // Create JSON data for backend using correct structure
      const jsonData = {
        id: importData.chatId,
        messages: selectedMessages.map(msg => ({
          id: msg.id,
          type: 'message',
          file: msg.type === 'photo' ? '' : msg.filename,
          photo: msg.type === 'photo' ? msg.filename : ''
        }))
      }

      // Start download via API with JSON data
      const response = await ApiService.startDownloadFromJson({
        chatId: importData.chatId.toString(),
        downloadPath: downloadPath.trim(),
        template: template.trim() || settings.defaultTemplate,
        jsonData,
        selectedMessageIds: selectedMessages.map(msg => msg.id),
        taskId: task.id
      })

      if (response.data.success) {
        toast({
          title: '导入下载已开始',
          description: `任务 ${task.name} 已添加到队列`
        })
        
        setOpen(false)
        resetForm()
      } else {
        toast({
          title: '启动下载失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }

    } catch (error: any) {
      console.error('Start import download error:', error)
      toast({
        title: '启动下载失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setImportData(null)
    setDownloadPath(settings.defaultPath || './downloads')
    setTemplate(settings.defaultTemplate || '{DialogID}_{MessageID}_{FileName}')
    setOnlySelected(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const selectedCount = importData?.mediaMessages.filter(msg => msg.selected).length || 0
  const totalSize = importData?.mediaMessages
    .filter(msg => msg.selected)
    .reduce((sum, msg) => sum + (msg.fileSize || 0), 0) || 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            导入聊天文件
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Upload className="h-5 w-5 mr-2" />
            导入聊天导出文件
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* File Upload */}
          <div className="space-y-2">
            <Label htmlFor="jsonFile">选择聊天导出文件 *</Label>
            <div className="flex gap-2">
              <Input
                ref={fileInputRef}
                id="jsonFile"
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                disabled={analyzing}
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={analyzing}
              >
                {analyzing ? '解析中...' : '选择文件'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              选择通过聊天页面导出的JSON格式消息文件
            </p>
          </div>

          {/* Analysis Results */}
          {importData && (
            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center justify-between">
                <h4 className="font-medium flex items-center">
                  <Info className="h-4 w-4 mr-2" />
                  文件分析结果
                </h4>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span>聊天: {importData.chatTitle}</span>
                  <span>总消息: {importData.totalMessages}</span>
                  <span>媒体文件: {importData.mediaMessages.length}</span>
                </div>
              </div>

              {importData.mediaMessages.length > 0 ? (
                <div className="space-y-3">
                  {/* Media file selection controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={toggleSelectAll}
                      >
                        {importData.mediaMessages.every(msg => msg.selected) ? (
                          <>
                            <Square className="h-4 w-4 mr-1" />
                            取消全选
                          </>
                        ) : (
                          <>
                            <CheckSquare className="h-4 w-4 mr-1" />
                            全选
                          </>
                        )}
                      </Button>
                      <span className="text-sm text-muted-foreground">
                        已选择 {selectedCount} / {importData.mediaMessages.length} 个文件
                      </span>
                      {totalSize > 0 && (
                        <span className="text-sm text-muted-foreground">
                          约 {(totalSize / 1024 / 1024).toFixed(1)} MB
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Media files list */}
                  <div className="max-h-60 overflow-y-auto border rounded">
                    <div className="grid gap-1">
                      {importData.mediaMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer ${
                            msg.selected ? 'bg-blue-50' : ''
                          }`}
                          onClick={() => toggleMessageSelect(msg.id)}
                        >
                          <Checkbox
                            checked={msg.selected}
                            onCheckedChange={() => toggleMessageSelect(msg.id)}
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          />
                          {getFileTypeIcon(msg.type)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {msg.filename || `${msg.type}_${msg.id}`}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ID: {msg.id}
                              </span>
                            </div>
                            {(msg.fileSize || msg.date) && (
                              <div className="flex gap-2 text-xs text-muted-foreground">
                                {msg.fileSize && (
                                  <span>{(msg.fileSize / 1024 / 1024).toFixed(1)} MB</span>
                                )}
                                {msg.date && (
                                  <span>{new Date(msg.date * 1000).toLocaleDateString()}</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <AlertCircle className="h-8 w-8 text-yellow-600 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    该JSON文件中未找到媒体文件
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Download Configuration */}
          {importData && importData.mediaMessages.length > 0 && (
            <div className="space-y-4 border rounded-lg p-4">
              <h4 className="font-medium">下载配置</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="importDownloadPath">下载路径 *</Label>
                  <Input
                    id="importDownloadPath"
                    value={downloadPath}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDownloadPath(e.target.value)}
                    placeholder="请输入下载保存路径"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="importTemplate">文件命名模板</Label>
                  <Input
                    id="importTemplate"
                    value={template}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTemplate(e.target.value)}
                    placeholder="{DialogID}_{MessageID}_{FileName}"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={onlySelected}
                  onCheckedChange={(checked: boolean | 'indeterminate') => setOnlySelected(checked === true)}
                />
                <span className="text-sm">仅下载选中的文件</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false)
                resetForm()
              }}
              disabled={loading || analyzing}
            >
              取消
            </Button>
            <Button
              onClick={handleStartDownload}
              disabled={
                loading || 
                analyzing || 
                !importData || 
                importData.mediaMessages.length === 0 ||
                selectedCount === 0 ||
                !downloadPath.trim()
              }
            >
              <Download className="h-4 w-4 mr-2" />
              {loading ? '启动中...' : `开始下载 (${selectedCount}个文件)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}