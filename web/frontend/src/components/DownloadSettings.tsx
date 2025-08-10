import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { useDownloadStore } from '@/store/downloadStore'
import { Settings, Save, RotateCcw, HardDrive, Zap, Filter } from 'lucide-react'

interface DownloadSettingsProps {
  trigger?: React.ReactNode
}

export function DownloadSettings({ trigger }: DownloadSettingsProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const { settings, updateSettings, saveSettings, resetSettings, isLoading } = useDownloadStore()
  
  // Local state for form editing
  const [localSettings, setLocalSettings] = useState(settings)
  
  // Sync with store when settings change
  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])
  
  const handleSave = async () => {
    try {
      setLoading(true)
      updateSettings(localSettings)
      await saveSettings()
      toast({
        title: '设置已保存',
        description: '下载设置已成功更新'
      })
      setOpen(false)
    } catch (error: any) {
      toast({
        title: '保存失败',
        description: error.response?.data?.message || '网络错误',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }
  
  const handleReset = () => {
    resetSettings()
    setLocalSettings(settings)
    toast({
      title: '设置已重置',
      description: '已恢复为默认设置'
    })
  }
  
  const handleFileTypeToggle = (fileType: string, checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setLocalSettings(prev => ({
        ...prev,
        fileTypes: [...prev.fileTypes, fileType]
      }))
    } else {
      setLocalSettings(prev => ({
        ...prev,
        fileTypes: prev.fileTypes.filter(type => type !== fileType)
      }))
    }
  }
  
  const FILE_TYPES = [
    { value: 'photo', label: '图片' },
    { value: 'video', label: '视频' },
    { value: 'document', label: '文档' },
    { value: 'audio', label: '音频' },
    { value: 'voice', label: '语音' },
    { value: 'gif', label: 'GIF' },
    { value: 'sticker', label: '贴纸' },
  ]
  
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline">
            <Settings className="h-4 w-4 mr-2" />
            设置
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center">
            <Settings className="h-5 w-5 mr-2" />
            下载设置
          </DialogTitle>
        </DialogHeader>
        
        <Tabs defaultValue="general" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">常规设置</TabsTrigger>
            <TabsTrigger value="performance">性能设置</TabsTrigger>
            <TabsTrigger value="advanced">高级设置</TabsTrigger>
          </TabsList>
          
          <TabsContent value="general" className="space-y-4">
            {/* General Settings */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="defaultPath" className="flex items-center">
                  <HardDrive className="h-4 w-4 mr-2" />
                  默认下载路径
                </Label>
                <Input
                  id="defaultPath"
                  value={localSettings.defaultPath}
                  onChange={(e) => setLocalSettings(prev => ({
                    ...prev,
                    defaultPath: e.target.value
                  }))}
                  placeholder="请输入默认下载路径"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="template">文件命名模板</Label>
                <Input
                  id="template"
                  value={localSettings.defaultTemplate}
                  onChange={(e) => setLocalSettings(prev => ({
                    ...prev,
                    defaultTemplate: e.target.value
                  }))}
                  placeholder="{DialogID}_{MessageID}_{FileName}"
                />
                <p className="text-xs text-muted-foreground">
                  可用变量: {'{DialogID}'}, {'{MessageID}'}, {'{FileName}'}, {'{FileSize}'}
                </p>
              </div>
              
              <div className="space-y-3">
                <Label>默认文件类型</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {FILE_TYPES.map(type => (
                    <label key={type.value} className="flex items-center space-x-2">
                      <Checkbox
                        checked={localSettings.fileTypes.includes(type.value)}
                        onCheckedChange={(checked: boolean | 'indeterminate') => 
                          handleFileTypeToggle(type.value, checked === true)
                        }
                      />
                      <span className="text-sm">{type.label}</span>
                    </label>
                  ))}\n                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex items-center space-x-2">
                  <Checkbox
                    checked={localSettings.skipDuplicates}
                    onCheckedChange={(checked: boolean | 'indeterminate') => setLocalSettings(prev => ({
                      ...prev,
                      skipDuplicates: checked === true
                    }))}
                  />
                  <span className="text-sm">跳过重复文件</span>
                </label>
                
                <label className="flex items-center space-x-2">
                  <Checkbox
                    checked={localSettings.rewriteExt}
                    onCheckedChange={(checked: boolean | 'indeterminate') => setLocalSettings(prev => ({
                      ...prev,
                      rewriteExt: checked === true
                    }))}
                  />
                  <span className="text-sm">重写文件扩展名</span>
                </label>
                
                <label className="flex items-center space-x-2">
                  <Checkbox
                    checked={localSettings.continueOnError}
                    onCheckedChange={(checked: boolean | 'indeterminate') => setLocalSettings(prev => ({
                      ...prev,
                      continueOnError: checked === true
                    }))}
                  />
                  <span className="text-sm">错误时继续</span>
                </label>
                
                <label className="flex items-center space-x-2">
                  <Checkbox
                    checked={localSettings.desc}
                    onCheckedChange={(checked: boolean | 'indeterminate') => setLocalSettings(prev => ({
                      ...prev,
                      desc: checked === true
                    }))}
                  />
                  <span className="text-sm">按时间倒序</span>
                </label>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="performance" className="space-y-4">
            {/* Performance Settings */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="concurrency" className="flex items-center">
                    <Zap className="h-4 w-4 mr-2" />
                    并发数
                  </Label>
                  <Input
                    id="concurrency"
                    type="number"
                    min="1"
                    max="16"
                    value={localSettings.concurrency}
                    onChange={(e) => setLocalSettings(prev => ({
                      ...prev,
                      concurrency: parseInt(e.target.value) || 4
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    同时下载的文件数量 (1-16)
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="retryCount">重试次数</Label>
                  <Input
                    id="retryCount"
                    type="number"
                    min="0"
                    max="10"
                    value={localSettings.retryCount}
                    onChange={(e) => setLocalSettings(prev => ({
                      ...prev,
                      retryCount: parseInt(e.target.value) || 3
                    }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    下载失败时的重试次数 (0-10)
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="advanced" className="space-y-4">
            {/* Advanced Settings */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="filters" className="flex items-center">
                  <Filter className="h-4 w-4 mr-2" />
                  常用过滤器
                </Label>
                <Input
                  id="filters"
                  value={localSettings.filters.join(', ')}
                  onChange={(e) => setLocalSettings(prev => ({
                    ...prev,
                    filters: e.target.value.split(',').map(f => f.trim()).filter(f => f)
                  }))}
                  placeholder="true, Size > 1024, Type == 'photo'"
                />
                <p className="text-xs text-muted-foreground">
                  预设的过滤表达式，用逗号分隔
                </p>
              </div>
              
              <label className="flex items-center space-x-2">
                <Checkbox
                  checked={localSettings.takeout}
                  onCheckedChange={(checked: boolean | 'indeterminate') => setLocalSettings(prev => ({
                    ...prev,
                    takeout: checked === true
                  }))}
                />
                <span className="text-sm">默认使用 Takeout 会话</span>
              </label>
            </div>
          </TabsContent>
        </Tabs>
        
        {/* Actions */}
        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={loading || isLoading}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            重置
          </Button>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading || isLoading}
            >
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={loading || isLoading}
            >
              <Save className="h-4 w-4 mr-2" />
              {loading ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}