# tdl Web Interface

基于现代Web技术栈为tdl构建的Web前端界面。

## 🚀 技术栈

### 后端
- **Gin** - 高性能Go Web框架
- **WebSocket** - 实时进度更新和通知
- **CORS** - 跨域资源共享支持
- **集成tdl核心** - 复用现有CLI功能

### 前端  
- **React 18** - 现代化前端框架
- **TypeScript** - 类型安全
- **Tailwind CSS** - 实用优先的样式框架
- **Radix-UI** - 无障碍UI组件库
- **Vite** - 快速构建工具
- **Zustand** - 轻量级状态管理
- **React Query** - 服务端状态管理

## 🏗️ 项目结构

```
tdl/
├── web/
│   ├── backend/              # Go API后端
│   │   ├── api/             # API路由处理器
│   │   ├── middleware/      # 中间件
│   │   ├── websocket/       # WebSocket处理
│   │   └── server.go        # Gin服务器
│   └── frontend/            # React前端
│       ├── src/
│       │   ├── components/  # UI组件
│       │   ├── pages/       # 页面组件
│       │   ├── store/       # 状态管理
│       │   ├── hooks/       # 自定义Hooks
│       │   └── utils/       # 工具函数
│       ├── package.json
│       └── tailwind.config.js
├── cmd/web.go               # Web命令
└── scripts/
    ├── dev-web.sh          # 开发环境启动
    ├── build-web.sh        # 生产构建
    └── test-web.sh         # 功能测试
```

## ⚡ 快速开始

### 开发环境

```bash
# 启动开发服务器（前后端同时）
./scripts/dev-web.sh

# 访问地址
# 前端: http://localhost:3000
# 后端: http://localhost:8080
```

### 生产构建

```bash
# 构建Web应用
./scripts/build-web.sh

# 运行
./tdl-web web --port 8080
```

### 单独启动

```bash
# 仅启动后端API服务器
go run main.go web --port 8080

# 仅启动前端开发服务器
cd web/frontend && npm run dev
```

## 🔧 开发指南

### API端点

#### 认证
- `GET /api/v1/auth/status` - 获取认证状态
- `POST /api/v1/auth/login/qr` - 二维码登录
- `POST /api/v1/auth/login/code` - 验证码登录
- `POST /api/v1/auth/logout` - 退出登录

#### 下载管理
- `GET /api/v1/download/chats` - 获取聊天列表
- `POST /api/v1/download/start` - 开始下载任务
- `GET /api/v1/download/tasks` - 获取下载任务列表
- `DELETE /api/v1/download/tasks/:id` - 取消下载任务

#### 上传管理
- `POST /api/v1/upload/start` - 开始上传任务
- `GET /api/v1/upload/tasks` - 获取上传任务列表
- `DELETE /api/v1/upload/tasks/:id` - 取消上传任务

#### 设置
- `GET /api/v1/settings/` - 获取设置
- `PUT /api/v1/settings/` - 更新设置

#### WebSocket
- `GET /ws` - WebSocket连接端点
- 消息类型: `progress`, `task_start`, `task_end`, `task_error`, `notification`

### 前端组件

#### 页面组件
- `LoginPage` - 登录页面
- `DashboardPage` - 仪表板
- `DownloadPage` - 下载管理
- `UploadPage` - 上传管理  
- `SettingsPage` - 设置页面

#### 状态管理
- `useAuthStore` - 认证状态
- `useTaskStore` - 任务状态
- `useWebSocket` - WebSocket连接

## 🌟 核心功能

### 已实现
- ✅ 基础架构搭建
- ✅ API服务器(Gin)
- ✅ WebSocket实时通信
- ✅ React前端框架
- ✅ 路由和状态管理
- ✅ 基础UI组件
- ✅ 开发和构建脚本

### 计划中
- 🔄 真实的Telegram认证集成
- 🔄 文件下载进度显示
- 🔄 批量下载管理
- 🔄 上传功能实现
- 🔄 设置页面完善
- 🔄 文件预览功能
- 🔄 任务历史记录

## 🐛 故障排除

### 常见问题

1. **端口被占用**
   ```bash
   # 查找占用进程
   lsof -ti:8080 | xargs kill -9
   ```

2. **前端依赖安装失败**
   ```bash
   # 修复npm权限
   sudo chown -R $(id -u):$(id -g) ~/.npm
   ```

3. **Go编译错误**
   ```bash
   # 清理模块缓存
   go clean -modcache && go mod tidy
   ```

### 开发调试

```bash
# 查看前端日志
tail -f web/frontend/vite.log

# 查看后端日志  
go run main.go web --port 8080 --debug

# 测试API端点
./scripts/test-web.sh
```

## 📝 开发注意事项

1. **API兼容性**: 当前实现使用模拟数据，需要逐步集成真实的tdl功能
2. **状态管理**: 前端状态与后端保持同步，通过WebSocket实时更新
3. **错误处理**: 统一的错误响应格式和用户友好的错误提示
4. **性能优化**: 大文件传输时的进度显示和内存管理
5. **安全性**: 认证机制和API权限控制

## 🤝 贡献指南

1. 遵循现有代码风格和架构模式
2. API更改需要同步更新前端接口
3. 添加新功能时考虑WebSocket事件通知
4. 确保响应式设计和无障碍支持
5. 编写相应的测试用例

---

🎉 **tdl Web Interface已准备就绪！** 可以开始开发现代化的Telegram下载管理界面了。