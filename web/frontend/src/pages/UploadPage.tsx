import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const UploadPage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">上传管理</h1>
        <p className="text-muted-foreground">
          管理和监控文件上传到 Telegram
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>上传任务</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            暂无上传任务
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default UploadPage