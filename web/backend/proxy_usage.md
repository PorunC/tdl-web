# 网络代理配置说明

Web界面的QR码登录现在支持通过网络代理连接到Telegram服务器。

## 配置方法

### 方法1：环境变量（推荐）
设置环境变量 `TDL_PROXY`：

```bash
export TDL_PROXY="http://192.168.96.1:7890"
./tdl-web
```

或者在启动时直接指定：

```bash
TDL_PROXY="http://192.168.96.1:7890" ./tdl-web
```

### 方法2：修改默认配置
如果不设置环境变量，程序会使用默认代理地址：`http://192.168.96.1:7890`

可以在 `web/backend/service/auth.go` 文件的 `getProxyURL()` 函数中修改默认值。

## 支持的代理类型

支持所有标准代理协议：
- HTTP: `http://proxy.example.com:8080`
- HTTPS: `https://proxy.example.com:8080`
- SOCKS5: `socks5://proxy.example.com:1080`
- 带认证的代理: `http://username:password@proxy.example.com:8080`

## 注意事项

1. 代理配置目前仅对QR码登录生效
2. 验证码登录功能目前是简化实现，不使用代理
3. 如果代理配置错误，QR码登录会失败并显示相应错误信息
4. 请确保代理服务器可以访问Telegram API服务器