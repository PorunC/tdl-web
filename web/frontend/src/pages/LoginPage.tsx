import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuthStore, LoginStatus } from '@/store/authStore'
import { toast } from '@/components/ui/use-toast'
import { QrCode, Phone, KeyRound, ChevronDown, ChevronRight, Settings } from 'lucide-react'

const LoginPage = () => {
  const [activeTab, setActiveTab] = useState('qr')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [proxyUrl, setProxyUrl] = useState('')

  const {
    isLoading,
    loginSession,
    startQRLogin,
    getQRCode,
    checkQRStatus,
    startCodeLogin,
    verifyCode,
    verifyPassword,
    clearSession
  } = useAuthStore()

  // 初始化时从localStorage读取代理设置
  useEffect(() => {
    const savedProxy = localStorage.getItem('tdl-proxy-url')
    if (savedProxy) {
      setProxyUrl(savedProxy)
    }
  }, [])

  // 保存代理设置到localStorage
  useEffect(() => {
    if (proxyUrl) {
      localStorage.setItem('tdl-proxy-url', proxyUrl)
    } else {
      localStorage.removeItem('tdl-proxy-url')
    }
  }, [proxyUrl])

  // QR登录状态轮询
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    
    if (loginSession?.status === 'initializing' ||
        loginSession?.status === 'waiting_qr' || 
        loginSession?.status === 'waiting_code' ||
        loginSession?.status === 'waiting_password') {
      interval = setInterval(() => {
        if (loginSession.sessionId) {
          checkQRStatus(loginSession.sessionId)
        }
      }, 2000)
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [loginSession?.status, loginSession?.sessionId, checkQRStatus])

  // 处理登录状态变化
  useEffect(() => {
    if (loginSession) {
      switch (loginSession.status) {
        case 'waiting_qr':
          if (loginSession.sessionId) {
            setQrCodeUrl(getQRCode(loginSession.sessionId))
          }
          break
        case 'completed':
          toast({
            title: "登录成功",
            description: `欢迎 ${loginSession.user?.first_name || '用户'}`
          })
          clearSession()
          break
        case 'failed':
          toast({
            title: "登录失败",
            description: loginSession.error || "登录过程中发生错误",
            variant: "destructive"
          })
          break
        case 'expired':
          toast({
            title: "登录过期",
            description: "请重新开始登录流程",
            variant: "destructive"
          })
          clearSession()
          break
      }
    }
  }, [loginSession, getQRCode, clearSession])

  const handleQRLogin = async () => {
    try {
      await startQRLogin(proxyUrl.trim() || undefined)
    } catch (error) {
      toast({
        title: "启动失败",
        description: "无法启动二维码登录，请重试",
        variant: "destructive"
      })
    }
  }

  const handleCodeLogin = async () => {
    if (!phone.trim()) {
      toast({
        title: "输入错误",
        description: "请输入手机号码",
        variant: "destructive"
      })
      return
    }
    
    try {
      await startCodeLogin(phone.trim(), proxyUrl.trim() || undefined)
    } catch (error) {
      toast({
        title: "发送失败",
        description: "无法发送验证码，请检查手机号",
        variant: "destructive"
      })
    }
  }

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      toast({
        title: "输入错误",
        description: "请输入验证码",
        variant: "destructive"
      })
      return
    }

    if (!loginSession?.sessionId) {
      toast({
        title: "会话错误",
        description: "登录会话无效，请重新开始",
        variant: "destructive"
      })
      return
    }

    try {
      await verifyCode(loginSession.sessionId, code.trim())
    } catch (error) {
      toast({
        title: "验证失败",
        description: "验证码错误或已过期",
        variant: "destructive"
      })
    }
  }

  const handleVerifyPassword = async () => {
    if (!password.trim()) {
      toast({
        title: "输入错误",
        description: "请输入两步验证密码",
        variant: "destructive"
      })
      return
    }

    if (!loginSession?.sessionId) {
      toast({
        title: "会话错误",
        description: "登录会话无效，请重新开始",
        variant: "destructive"
      })
      return
    }

    try {
      await verifyPassword(loginSession.sessionId, password.trim())
    } catch (error) {
      toast({
        title: "验证失败",
        description: "两步验证密码错误",
        variant: "destructive"
      })
    }
  }

  const getStatusMessage = (status: LoginStatus) => {
    switch (status) {
      case 'initializing':
        return '正在初始化...'
      case 'waiting_qr':
        return '请使用 Telegram 扫描二维码'
      case 'waiting_code':
        return '请输入收到的验证码'
      case 'waiting_password':
        return '请输入两步验证密码'
      case 'completed':
        return '登录完成'
      case 'failed':
        return '登录失败'
      case 'expired':
        return '登录已过期'
      default:
        return ''
    }
  }

  const isWaitingForPassword = loginSession?.status === 'waiting_password'
  const isWaitingForCode = loginSession?.status === 'waiting_code'

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">tdl 登录</CardTitle>
          <p className="text-muted-foreground">
            请选择登录方式连接到 Telegram
          </p>
        </CardHeader>
        <CardContent>
          {isWaitingForPassword ? (
            // 两步验证界面
            <div className="space-y-4">
              <div className="text-center">
                <KeyRound className="h-12 w-12 mx-auto text-primary mb-2" />
                <h3 className="text-lg font-semibold">两步验证</h3>
                <p className="text-sm text-muted-foreground">
                  {getStatusMessage(loginSession.status)}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="password">两步验证密码</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                  placeholder="输入两步验证密码"
                  disabled={isLoading}
                />
              </div>
              
              <Button
                onClick={handleVerifyPassword}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? '验证中...' : '验证密码'}
              </Button>
              
              <Button
                onClick={clearSession}
                variant="outline"
                className="w-full"
              >
                重新登录
              </Button>
            </div>
          ) : isWaitingForCode ? (
            // 验证码输入界面
            <div className="space-y-4">
              <div className="text-center">
                <Phone className="h-12 w-12 mx-auto text-primary mb-2" />
                <h3 className="text-lg font-semibold">输入验证码</h3>
                <p className="text-sm text-muted-foreground">
                  {getStatusMessage(loginSession.status)}
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="code">验证码</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCode(e.target.value)}
                  placeholder="输入收到的验证码"
                  disabled={isLoading}
                />
              </div>
              
              <Button
                onClick={handleVerifyCode}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? '验证中...' : '验证登录'}
              </Button>
              
              <Button
                onClick={clearSession}
                variant="outline"
                className="w-full"
              >
                重新登录
              </Button>
            </div>
          ) : (
            // 主登录界面
            <div className="space-y-4">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="qr">
                  <QrCode className="h-4 w-4 mr-2" />
                  二维码
                </TabsTrigger>
                <TabsTrigger value="phone">
                  <Phone className="h-4 w-4 mr-2" />
                  手机号
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="qr" className="space-y-4">
                {loginSession?.status === 'waiting_qr' && qrCodeUrl ? (
                  <div className="text-center space-y-4">
                    <div className="bg-white p-4 rounded-lg inline-block">
                      <img 
                        src={qrCodeUrl} 
                        alt="QR Code" 
                        className="w-48 h-48 mx-auto"
                      />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {getStatusMessage(loginSession.status)}
                    </p>
                    <Button
                      onClick={clearSession}
                      variant="outline"
                      className="w-full"
                    >
                      取消登录
                    </Button>
                  </div>
                ) : loginSession?.status === 'initializing' ? (
                  <div className="text-center space-y-4">
                    <div className="flex items-center justify-center space-x-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                      <span className="text-sm text-muted-foreground">
                        {getStatusMessage(loginSession.status)}
                      </span>
                    </div>
                    <Button
                      onClick={clearSession}
                      variant="outline"
                      className="w-full"
                    >
                      取消登录
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-center">
                      <QrCode className="h-16 w-16 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        使用 Telegram 扫描二维码快速登录
                      </p>
                    </div>
                    
                    <Button
                      onClick={handleQRLogin}
                      disabled={isLoading}
                      className="w-full"
                    >
                      {isLoading ? '生成中...' : '生成二维码'}
                    </Button>
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="phone" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">手机号码</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
                    placeholder="+86 12345678900"
                    disabled={isLoading}
                  />
                </div>
                
                <Button
                  onClick={handleCodeLogin}
                  disabled={isLoading || !phone.trim()}
                  className="w-full"
                >
                  {isLoading ? '发送中...' : '发送验证码'}
                </Button>
                
                <p className="text-xs text-muted-foreground text-center">
                  请输入注册 Telegram 时使用的手机号码
                </p>
              </TabsContent>
            </Tabs>
            
            {/* 高级设置 */}
            <div className="mt-4 border-t pt-4">
              <Button
                onClick={() => setShowAdvanced(!showAdvanced)}
                variant="ghost"
                className="w-full flex items-center justify-center space-x-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <Settings className="h-4 w-4" />
                <span>高级设置</span>
                {showAdvanced ? 
                  <ChevronDown className="h-4 w-4" /> : 
                  <ChevronRight className="h-4 w-4" />
                }
              </Button>
              
              {showAdvanced && (
                <div className="mt-3 space-y-3 p-3 bg-muted/50 rounded-md">
                  <div className="space-y-2">
                    <Label htmlFor="proxy" className="text-xs">网络代理 (可选)</Label>
                    <Input
                      id="proxy"
                      type="text"
                      value={proxyUrl}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setProxyUrl(e.target.value)}
                      placeholder="http://192.168.96.1:7890"
                      className="text-xs"
                      disabled={isLoading}
                    />
                    <p className="text-xs text-muted-foreground">
                      支持 HTTP/HTTPS/SOCKS5 代理，留空则直连
                    </p>
                  </div>
                </div>
              )}
            </div>
            </div>
          )}
          
          {loginSession?.status && (
            <div className="mt-4 p-2 bg-muted rounded text-xs text-center">
              状态: {getStatusMessage(loginSession.status)}
            </div>
          )}
          
          <div className="text-xs text-muted-foreground text-center mt-4">
            首次使用需要授权 Telegram 应用访问权限
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default LoginPage