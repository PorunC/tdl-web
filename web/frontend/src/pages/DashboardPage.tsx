import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const DashboardPage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">仪表板</h1>
        <p className="text-muted-foreground">
          Telegram 下载和上传管理中心
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              总下载量
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">1.2 GB</div>
            <p className="text-xs text-muted-foreground">
              本月 +20.1%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              活跃任务
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3</div>
            <p className="text-xs text-muted-foreground">
              2 下载，1 上传
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              完成任务
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">23</div>
            <p className="text-xs text-muted-foreground">
              本周 +4
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              平均速度
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">2.4 MB/s</div>
            <p className="text-xs text-muted-foreground">
              过去24小时
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近活动</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center space-x-4">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <div className="flex-1">
                <p className="text-sm font-medium">文档下载完成</p>
                <p className="text-xs text-muted-foreground">document.pdf - 5.2 MB</p>
              </div>
              <div className="text-xs text-muted-foreground">2分钟前</div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <div className="flex-1">
                <p className="text-sm font-medium">开始下载任务</p>
                <p className="text-xs text-muted-foreground">群组: 技术交流群</p>
              </div>
              <div className="text-xs text-muted-foreground">5分钟前</div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              <div className="flex-1">
                <p className="text-sm font-medium">上传文件</p>
                <p className="text-xs text-muted-foreground">report.docx - 正在上传</p>
              </div>
              <div className="text-xs text-muted-foreground">10分钟前</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default DashboardPage