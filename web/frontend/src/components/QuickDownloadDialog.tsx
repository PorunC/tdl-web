import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
// Removed unused Select imports
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import { useTaskStore, Task, DownloadConfig, ChatInfo } from '@/store/taskStore'
import { useDownloadStore } from '@/store/downloadStore'
import { ApiService } from '@/utils/api'
import { Download, Plus, Settings } from 'lucide-react'

interface QuickDownloadDialogProps {
  trigger?: React.ReactNode
}

const FILE_TYPE_OPTIONS = [
  { value: 'photo', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'document', label: '文档' },
  { value: 'audio', label: '音频' },
  { value: 'voice', label: '语音' },
  { value: 'gif', label: 'GIF' },
  { value: 'sticker', label: '贴纸' },
]

export function QuickDownloadDialog({ trigger }: QuickDownloadDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [urls, setUrls] = useState('')
  const [downloadPath, setDownloadPath] = useState('')
  const [fileTypes, setFileTypes] = useState<string[]>(['photo', 'video', 'document'])
  const [filter, setFilter] = useState('true')
  const [template, setTemplate] = useState('')
  const [includeFilters, setIncludeFilters] = useState<string[]>([])
  const [excludeFilters, setExcludeFilters] = useState<string[]>([])
  const [takeout, setTakeout] = useState(false)
  const [continueDownload, setContinueDownload] = useState(true)
  const [desc, setDesc] = useState(false)
  
  const { toast } = useToast()
  const { addTask } = useTaskStore()
  const { settings, loadSettings, updateSettings } = useDownloadStore()

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    // Set defaults from store when available
    if (settings.defaultPath && !downloadPath) {
      setDownloadPath(settings.defaultPath)
    }
    if (settings.defaultTemplate && !template) {
      setTemplate(settings.defaultTemplate)
    }
    if (settings.fileTypes.length > 0) {
      setFileTypes(settings.fileTypes)
    }
    setDesc(settings.desc)
    setTakeout(settings.takeout)
  }, [settings, downloadPath, template])

  const handleFileTypeToggle = (fileType: string, checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setFileTypes(prev => [...prev, fileType])
    } else {
      setFileTypes(prev => prev.filter(type => type !== fileType))
    }
  }

  const parseUrls = (urlsText: string): string[] => {
    return urlsText
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0)
  }

  const parseFilterArray = (filtersText: string): string[] => {
    return filtersText
      .split(',')
      .map(f => f.trim())
      .filter(f => f.length > 0)
  }

  const validateUrls = (urls: string[]): boolean => {
    const telegramUrlPattern = /^https:\/\/(t\.me|telegram\.me)\/[a-zA-Z0-9_]+\/\d+/
    return urls.every(url => telegramUrlPattern.test(url))
  }

  const handleSubmit = async () => {
    try {
      setLoading(true)
      
      const urlList = parseUrls(urls)
      if (urlList.length === 0) {
        toast({
          title: '输入错误',
          description: '请输入至少一个有效的Telegram消息链接',
          variant: 'destructive'
        })
        return
      }

      if (!validateUrls(urlList)) {
        toast({
          title: '链接格式错误',
          description: '请确保所有链接都是有效的Telegram消息链接 (t.me/chat/123)',
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

      // Parse chat info from URLs
      const chatInfo: ChatInfo | undefined = urlList.length > 0 ? {
        id: urlList[0].split('/').slice(-2, -1)[0],
        title: `批量下载 (${urlList.length}个链接)`,
        type: 'channel' // Default type
      } : undefined

      const downloadConfig: DownloadConfig = {
        urls: urlList,
        fileTypes,
        filter,
        downloadPath: downloadPath.trim(),
        template: template.trim() || settings.defaultTemplate,
        include: includeFilters.length > 0 ? includeFilters : undefined,
        exclude: excludeFilters.length > 0 ? excludeFilters : undefined,
        takeout,
        continue: continueDownload,
        desc
      }

      // Create task
      const task: Task = {
        id: `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'download',
        name: `快速下载 (${urlList.length}个链接)`,
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
          filesTotal: 0,
          filesCompleted: 0,
          filesSkipped: 0,
          filesFailed: 0,
          errors: []
        }
      }

      // Add to store first
      addTask(task)

      // Start download via API
      const response = await ApiService.startDownload({
        chatId: chatInfo?.id || 'batch',
        fileTypes,
        filter,
        // Send additional config in the request
        downloadPath,
        urls: urlList,
        template,
        include: includeFilters,
        exclude: excludeFilters,
        takeout,
        continue: continueDownload,
        desc,
        taskId: task.id
      } as any)

      if (response.data.success) {
        toast({
          title: '下载已开始',
          description: `任务 ${task.name} 已添加到队列`
        })
        
        // Update settings with current values
        updateSettings({
          defaultPath: downloadPath,
          defaultTemplate: template,
          fileTypes,
          desc,
          takeout
        })
        
        // Reset form
        setUrls('')
        setFilter('true')
        setIncludeFilters([])
        setExcludeFilters([])
        
        setOpen(false)
      } else {
        toast({
          title: '启动下载失败',
          description: response.data.message,
          variant: 'destructive'
        })
      }
      
    } catch (error: any) {
      console.error('Start download error:', error)
      toast({
        title: '启动下载失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            快速下载
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Download className="h-5 w-5 mr-2" />
            快速下载
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* URLs Input */}
          <div className="space-y-2">
            <Label htmlFor="urls">消息链接 *</Label>
            <Textarea
              id="urls"
              value={urls}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setUrls(e.target.value)}
              placeholder={`请输入Telegram消息链接，每行一个：\nhttps://t.me/channel/123\nhttps://t.me/chat/456`}
              rows={4}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              支持 t.me 和 telegram.me 链接格式
            </p>
          </div>

          {/* Download Path */}
          <div className="space-y-2">
            <Label htmlFor="downloadPath">下载路径 *</Label>
            <Input
              id="downloadPath"
              value={downloadPath}
              onChange={(e) => setDownloadPath(e.target.value)}
              placeholder="请输入下载保存路径"
            />
          </div>

          {/* File Template */}
          <div className="space-y-2">
            <Label htmlFor="template">文件命名模板</Label>
            <Input
              id="template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="{{ .DialogID }}_{{ .MessageID }}_{{ filenamify .FileName }}"
            />
            <p className="text-xs text-muted-foreground">
              可用变量: {'{{ .DialogID }}'}, {'{{ .MessageID }}'}, {'{{ .FileName }}'}, {'{{ .FileSize }}'}, {'{{ filenamify .FileName }}'}
            </p>
          </div>

          {/* File Types */}
          <div className="space-y-3">
            <Label>文件类型</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {FILE_TYPE_OPTIONS.map(option => (
                <label key={option.value} className="flex items-center space-x-2">
                  <Checkbox
                    checked={fileTypes.includes(option.value)}
                    onCheckedChange={(checked: boolean | 'indeterminate') => 
                      handleFileTypeToggle(option.value, checked === true)
                    }
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Advanced Options */}
          <div className="space-y-4">
            <h4 className="font-medium flex items-center">
              <Settings className="h-4 w-4 mr-2" />
              高级选项
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="filter">过滤表达式</Label>
                <Input
                  id="filter"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="true"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="include">包含文件扩展名</Label>
                <Input
                  id="include"
                  value={includeFilters.join(', ')}
                  onChange={(e) => setIncludeFilters(parseFilterArray(e.target.value))}
                  placeholder="jpg, png, mp4"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="exclude">排除文件扩展名</Label>
                <Input
                  id="exclude"
                  value={excludeFilters.join(', ')}
                  onChange={(e) => setExcludeFilters(parseFilterArray(e.target.value))}
                  placeholder="tmp, log"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <label className="flex items-center space-x-2">
                <Checkbox
                  checked={takeout}
                  onCheckedChange={(checked: boolean | 'indeterminate') => setTakeout(checked === true)}
                />
                <span className="text-sm">使用 Takeout 会话</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <Checkbox
                  checked={continueDownload}
                  onCheckedChange={(checked: boolean | 'indeterminate') => setContinueDownload(checked === true)}
                />
                <span className="text-sm">断点续传</span>
              </label>
              
              <label className="flex items-center space-x-2">
                <Checkbox
                  checked={desc}
                  onCheckedChange={(checked: boolean | 'indeterminate') => setDesc(checked === true)}
                />
                <span className="text-sm">按时间倒序</span>
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={loading || !urls.trim() || !downloadPath.trim()}
            >
              {loading ? '启动中...' : '开始下载'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}