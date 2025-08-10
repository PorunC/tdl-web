package backend

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/iyear/tdl/core/logctx"
	"github.com/iyear/tdl/pkg/kv"
	"github.com/iyear/tdl/web/backend/api"
	"github.com/iyear/tdl/web/backend/middleware"
	"github.com/iyear/tdl/web/backend/websocket"
)

type Server struct {
	router *gin.Engine
	port   int
	ctx    context.Context
	kvd    kv.Storage
	wsHub  *websocket.Hub
}

type Config struct {
	Port  int
	Debug bool
}

func NewServer(ctx context.Context, kvd kv.Storage, config Config) *Server {
	if !config.Debug {
		gin.SetMode(gin.ReleaseMode)
	}

	router := gin.New()
	router.Use(gin.Recovery())

	// CORS配置
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000", "http://localhost:5173"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
		MaxAge:          12 * time.Hour,
	}))

	// 创建WebSocket Hub
	wsHub := websocket.NewHub()
	go wsHub.Run()

	server := &Server{
		router: router,
		port:   config.Port,
		ctx:    ctx,
		kvd:    kvd,
		wsHub:  wsHub,
	}

	server.setupRoutes()
	return server
}

func (s *Server) setupRoutes() {
	// 添加日志中间件
	s.router.Use(middleware.Logger(logctx.From(s.ctx)))

	// 静态文件服务（前端构建产物）
	s.router.Static("/assets", "./web/frontend/dist/assets")
	s.router.StaticFile("/", "./web/frontend/dist/index.html")

	// API路由组
	apiV1 := s.router.Group("/api/v1")
	{
		// 认证相关
		auth := apiV1.Group("/auth")
		{
			authHandler := api.NewAuthHandler(s.ctx, s.kvd, s.wsHub)
			auth.GET("/status", authHandler.GetStatus)
			
			// QR登录
			auth.POST("/qr/start", authHandler.StartQRLogin)
			auth.GET("/qr/code/:sessionId", authHandler.GetQRCode)
			auth.GET("/qr/status/:sessionId", authHandler.CheckQRStatus)
			
			// 验证码登录
			auth.POST("/code/start", authHandler.StartCodeLogin)
			auth.POST("/code/verify", authHandler.VerifyCode)
			
			// 2FA验证
			auth.POST("/password/verify", authHandler.VerifyPassword)
			
			// 登出
			auth.POST("/logout", authHandler.Logout)
		}

		// 聊天管理相关
		chatGroup := apiV1.Group("/chat")
		{
			chatHandler := api.NewChatHandler(s.ctx, s.kvd)
			chatGroup.GET("/list", chatHandler.GetChatList)           // 获取聊天列表
			chatGroup.GET("/default-path", chatHandler.GetDefaultDownloadPath) // 获取默认下载路径
			chatGroup.POST("/export", chatHandler.ExportChatMessages) // 导出聊天消息
			chatGroup.POST("/users", chatHandler.ExportChatUsers)     // 导出聊天用户
		}

		// 设置相关
		settingsGroup := apiV1.Group("/settings")
		{
			settingsHandler := api.NewSettingsHandler(s.ctx, s.kvd)
			settingsGroup.GET("/", settingsHandler.GetSettings)       // 获取设置
			settingsGroup.PUT("/", settingsHandler.UpdateSettings)    // 更新设置
			settingsGroup.POST("/reset", settingsHandler.ResetSettings) // 重置设置
		}

		// 下载管理相关
		downloadGroup := apiV1.Group("/download")
		{
			downloadHandler := api.NewDownloadHandler(s.ctx, s.kvd, s.wsHub)
			downloadGroup.POST("/start", downloadHandler.StartDownload)     // 开始下载任务
			downloadGroup.POST("/import", downloadHandler.ImportFromJson)   // 从JSON文件导入下载
			downloadGroup.GET("/tasks", downloadHandler.GetTasks)          // 获取下载任务列表
			downloadGroup.GET("/tasks/:id", downloadHandler.GetTaskDetails) // 获取任务详情
			downloadGroup.POST("/tasks/:id/pause", downloadHandler.PauseTask)   // 暂停任务
			downloadGroup.POST("/tasks/:id/resume", downloadHandler.ResumeTask) // 恢复任务
			downloadGroup.POST("/tasks/:id/retry", downloadHandler.RetryTask)   // 重试任务
			downloadGroup.DELETE("/tasks/:id", downloadHandler.CancelTask)     // 取消/删除任务
		}

		// 转发管理相关
		forwardGroup := apiV1.Group("/forward")
		{
			forwardHandler := api.NewForwardHandler(s.ctx, s.kvd, s.wsHub)
			forwardGroup.POST("/start", forwardHandler.StartForward)           // 开始转发任务
			forwardGroup.GET("/tasks", forwardHandler.GetForwardTasks)         // 获取转发任务列表
			forwardGroup.GET("/tasks/:id", forwardHandler.GetForwardTaskDetails) // 获取转发任务详情
			forwardGroup.DELETE("/tasks/:id", forwardHandler.CancelForwardTask)  // 取消转发任务
		}

		// 上传管理相关
		uploadGroup := apiV1.Group("/upload")
		{
			uploadHandler := api.NewUploadHandler(s.ctx, s.kvd, s.wsHub)
			uploadGroup.POST("/start", uploadHandler.StartUpload)              // 开始上传任务
			uploadGroup.GET("/tasks", uploadHandler.GetUploadTasks)            // 获取上传任务列表
			uploadGroup.GET("/tasks/:id", uploadHandler.GetUploadTaskDetails)  // 获取上传任务详情
			uploadGroup.DELETE("/tasks/:id", uploadHandler.CancelUploadTask)   // 取消上传任务
		}
	}

	// WebSocket端点
	s.router.GET("/ws", websocket.HandleWebSocket(s.wsHub))
}

func (s *Server) Start() error {
	logctx.From(s.ctx).Info("Starting web server", 
		zap.Int("port", s.port))

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", s.port),
		Handler: s.router,
	}

	// 优雅关闭
	go func() {
		<-s.ctx.Done()
		logctx.From(s.ctx).Info("Shutting down web server")
		
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		
		if err := srv.Shutdown(ctx); err != nil {
			logctx.From(s.ctx).Error("Server forced to shutdown", zap.Error(err))
		}
	}()

	return srv.ListenAndServe()
}