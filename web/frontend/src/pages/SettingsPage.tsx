import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

const SettingsPage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">设置</h1>
        <p className="text-muted-foreground">
          配置应用程序设置和首选项
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>系统设置</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            设置页面正在开发中...
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default SettingsPage