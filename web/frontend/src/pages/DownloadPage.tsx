import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const DownloadPage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">下载管理</h1>
        <p className="text-muted-foreground">
          管理和监控 Telegram 文件下载任务
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>下载任务</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            暂无下载任务
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default DownloadPage