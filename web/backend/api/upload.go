package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-faster/errors"
	"github.com/gotd/td/telegram"
	"go.uber.org/zap"

	"github.com/iyear/tdl/app/up"
	"github.com/iyear/tdl/core/logctx"
	tclientcore "github.com/iyear/tdl/core/tclient"
	"github.com/iyear/tdl/pkg/tclient"
	"github.com/iyear/tdl/core/storage"
	"github.com/iyear/tdl/pkg/kv"
	"github.com/iyear/tdl/web/backend/service"
	"github.com/iyear/tdl/web/backend/util"
	"github.com/iyear/tdl/web/backend/websocket"
)

type UploadHandler struct {
	ctx         context.Context
	kvd         kv.Storage
	wsHub       *websocket.Hub
	authService *service.AuthService
	activeTasks sync.Map // taskID -> context.CancelFunc
	taskStore   sync.Map // taskID -> UploadTaskInfo (in-memory storage)
}

func NewUploadHandler(ctx context.Context, kvd kv.Storage, wsHub *websocket.Hub) *UploadHandler {
	return &UploadHandler{
		ctx:         ctx,
		kvd:         kvd,
		wsHub:       wsHub,
		authService: service.NewAuthService(ctx, kvd),
		activeTasks: sync.Map{},
		taskStore:   sync.Map{},
	}
}

// UploadRequest represents an upload request from web interface
type UploadRequest struct {
	ToChat     string   `json:"to_chat"`                         // 目标聊天ID或用户名（空字符串表示Saved Messages）
	Excludes   []string `json:"excludes"`                        // 排除的文件扩展名
	Remove     bool     `json:"remove"`                          // 上传后删除文件
	Photo      bool     `json:"photo"`                           // 作为照片上传而不是文件
	TaskID     string   `json:"task_id"`                         // 任务ID
}

// UploadTaskInfo represents upload task information
type UploadTaskInfo struct {
	ID            string                 `json:"id"`
	Type          string                 `json:"type"`
	Name          string                 `json:"name"`
	Status        string                 `json:"status"`
	Progress      float64                `json:"progress"`
	Speed         string                 `json:"speed"`
	ETA           string                 `json:"eta"`
	Uploaded      int                    `json:"uploaded"`      // 已上传数量
	Total         int                    `json:"total"`         // 总数量
	Failed        int                    `json:"failed"`        // 失败数量
	CreatedAt     time.Time              `json:"created_at"`
	Error         string                 `json:"error,omitempty"`
	Config        map[string]interface{} `json:"config,omitempty"`
	ToChat        string                 `json:"to_chat"`       // 目标聊天
	FilePaths     []string               `json:"file_paths"`    // 文件路径列表
}

// FileUploadInfo represents single file upload statistics
type FileUploadInfo struct {
	FilePath    string    `json:"file_path"`
	Status      string    `json:"status"`
	Error       string    `json:"error,omitempty"`
	UploadedAt  time.Time `json:"uploaded_at,omitempty"`
}

// StartUpload 开始上传任务
func (h *UploadHandler) StartUpload(c *gin.Context) {
	// 解析multipart form
	err := c.Request.ParseMultipartForm(32 << 20) // 32MB max memory
	if err != nil {
		ValidationError(c, "Failed to parse multipart form: "+err.Error())
		return
	}

	// 获取表单字段
	toChat := c.PostForm("to_chat")
	excludesStr := c.PostForm("excludes")
	remove := c.PostForm("remove") == "true"
	photo := c.PostForm("photo") == "true"
	taskID := c.PostForm("task_id")

	var excludes []string
	if excludesStr != "" {
		excludes = strings.Split(excludesStr, ",")
		for i, exclude := range excludes {
			excludes[i] = strings.TrimSpace(exclude)
		}
	}

	// 生成任务ID
	if taskID == "" {
		taskID = fmt.Sprintf("upload-%d-%s", time.Now().Unix(), h.generateShortID())
	}

	// 获取上传的文件
	form := c.Request.MultipartForm
	files := form.File["files"]
	if len(files) == 0 {
		ValidationError(c, "No files provided for upload")
		return
	}

	// 保存文件到临时目录
	tempDir, err := h.createTempDir(taskID)
	if err != nil {
		logctx.From(h.ctx).Error("Failed to create temp directory", zap.Error(err))
		InternalServerError(c, "Failed to create temporary directory")
		return
	}

	var filePaths []string
	for _, fileHeader := range files {
		filePath := filepath.Join(tempDir, fileHeader.Filename)
		
		if err := h.saveUploadedFile(fileHeader, filePath); err != nil {
			logctx.From(h.ctx).Error("Failed to save uploaded file", 
				zap.String("filename", fileHeader.Filename), 
				zap.Error(err))
			InternalServerError(c, fmt.Sprintf("Failed to save file %s", fileHeader.Filename))
			return
		}
		
		filePaths = append(filePaths, filePath)
	}

	// 创建上传任务信息
	taskInfo := &UploadTaskInfo{
		ID:        taskID,
		Type:      "upload",
		Name:      fmt.Sprintf("上传 %d 个文件", len(filePaths)),
		Status:    "pending",
		Progress:  0,
		Speed:     "0 B/s",
		ETA:       "计算中...",
		Uploaded:  0,
		Total:     len(filePaths),
		Failed:    0,
		CreatedAt: time.Now(),
		ToChat:    toChat,
		FilePaths: filePaths,
		Config: map[string]interface{}{
			"excludes": excludes,
			"remove":   remove,
			"photo":    photo,
		},
	}

	// 存储任务信息
	h.taskStore.Store(taskID, taskInfo)

	// 获取客户端ID
	clientID, err := h.getOrCreateClientID(c)
	if err != nil {
		logctx.From(h.ctx).Error("Failed to get client ID", zap.Error(err))
		InternalServerError(c, "Failed to identify client")
		return
	}

	// 异步执行上传任务
	ctx, cancel := context.WithCancel(h.ctx)
	h.activeTasks.Store(taskID, cancel)

	go func() {
		defer func() {
			h.activeTasks.Delete(taskID)
			// 清理临时文件
			os.RemoveAll(tempDir)
		}()

		err := h.executeUpload(ctx, clientID, taskID, filePaths, up.Options{
			Chat:     toChat,
			Paths:    filePaths,
			Excludes: excludes,
			Remove:   remove,
			Photo:    photo,
		})

		// 更新任务状态
		if taskInfoRaw, ok := h.taskStore.Load(taskID); ok {
			taskInfo := taskInfoRaw.(*UploadTaskInfo)
			if err != nil {
				taskInfo.Status = "error"
				taskInfo.Error = err.Error()
				logctx.From(h.ctx).Error("Upload task failed", 
					zap.String("task_id", taskID), 
					zap.Error(err))
			} else {
				taskInfo.Status = "completed"
				taskInfo.Progress = 100
				logctx.From(h.ctx).Info("Upload task completed", 
					zap.String("task_id", taskID))
			}
			h.taskStore.Store(taskID, taskInfo)
		}
	}()

	Success(c, map[string]interface{}{
		"message":     "Upload task submitted successfully",
		"task_id":     taskID,
		"file_count":  len(filePaths),
		"to_chat":     toChat,
		"status":      "pending",
	})
}

// GetUploadTasks 获取上传任务列表
func (h *UploadHandler) GetUploadTasks(c *gin.Context) {
	var tasks []*UploadTaskInfo
	
	h.taskStore.Range(func(key, value interface{}) bool {
		if task, ok := value.(*UploadTaskInfo); ok {
			tasks = append(tasks, task)
		}
		return true
	})

	Success(c, map[string]interface{}{
		"message": "Upload tasks retrieved successfully",
		"tasks":   tasks,
	})
}

// GetUploadTaskDetails 获取上传任务详情
func (h *UploadHandler) GetUploadTaskDetails(c *gin.Context) {
	taskID := c.Param("id")
	
	taskInfoRaw, exists := h.taskStore.Load(taskID)
	if !exists {
		NotFoundError(c, "Upload task not found")
		return
	}

	taskInfo := taskInfoRaw.(*UploadTaskInfo)
	Success(c, map[string]interface{}{
		"message": "Upload task details retrieved successfully",
		"task":    taskInfo,
	})
}

// CancelUploadTask 取消上传任务
func (h *UploadHandler) CancelUploadTask(c *gin.Context) {
	taskID := c.Param("id")
	
	cancelFunc, exists := h.activeTasks.Load(taskID)
	if !exists {
		NotFoundError(c, "Upload task not found or already completed")
		return
	}

	// 取消任务
	if cancel, ok := cancelFunc.(context.CancelFunc); ok {
		cancel()
		h.activeTasks.Delete(taskID)
		
		// 更新任务状态
		if taskInfoRaw, ok := h.taskStore.Load(taskID); ok {
			taskInfo := taskInfoRaw.(*UploadTaskInfo)
			taskInfo.Status = "cancelled"
			h.taskStore.Store(taskID, taskInfo)
		}
	}

	Success(c, map[string]interface{}{
		"message": "Upload task cancelled successfully",
		"task_id": taskID,
	})
}

// executeUpload 执行真实的上传逻辑
func (h *UploadHandler) executeUpload(ctx context.Context, clientID, taskID string, filePaths []string, opts up.Options) error {
	logctx.From(ctx).Info("Starting upload task", 
		zap.String("task_id", taskID),
		zap.Int("file_count", len(filePaths)),
		zap.String("to_chat", opts.Chat))

	// 创建Telegram客户端
	client, storageInstance, err := h.createTelegramClientForUser(clientID)
	if err != nil {
		return errors.Wrap(err, "create telegram client for user")
	}

	// 使用 RunWithAuth 确保用户已认证
	return tclientcore.RunWithAuth(ctx, client, func(ctx context.Context) error {
		return up.Run(logctx.Named(ctx, "upload"), client, storageInstance, opts)
	})
}

// createTelegramClientForUser 为特定用户创建Telegram客户端，复制其他Handler的逻辑
func (h *UploadHandler) createTelegramClientForUser(clientID string) (*telegram.Client, storage.Storage, error) {
	// 获取Telegram ID
	telegramID, err := h.authService.GetAuthenticatedTelegramID(clientID)
	if err != nil {
		return nil, nil, errors.Wrap(err, "get authenticated telegram id")
	}

	// 使用用户命名空间
	namespace := fmt.Sprintf("user_%d", telegramID)
	return h.createTelegramClient(namespace)
}

// createTelegramClient 创建Telegram客户端，使用与CLI相同的配置
func (h *UploadHandler) createTelegramClient(namespace string) (*telegram.Client, storage.Storage, error) {
	// 通过kv.Storage获取storage.Storage实例
	storageInstance, err := h.kvd.Open(namespace)
	if err != nil {
		return nil, nil, errors.Wrap(err, "open storage")
	}

	// 获取当前设置
	settingsHandler := NewSettingsHandler(h.ctx, h.kvd)
	settings, err := settingsHandler.GetCurrentSettings()
	if err != nil {
		return nil, nil, errors.Wrap(err, "get current settings")
	}

	// 使用与CLI相同的tOptions配置
	o := tclient.Options{
		KV:               storageInstance,
		Proxy:            settings.GlobalProxy, // 从设置中获取代理配置
		NTP:              "", // NTP配置暂时为空
		ReconnectTimeout: time.Duration(settings.ReconnectTimeout) * time.Second, // 从设置中获取重连超时
		UpdateHandler:    nil,
	}

	// 记录配置信息
	logctx.From(h.ctx).Info("Creating Telegram client for upload with settings",
		zap.String("proxy", o.Proxy),
		zap.Duration("reconnectTimeout", o.ReconnectTimeout))

	// 创建客户端，使用与CLI相同的参数
	client, err := tclient.New(h.ctx, o, false) // false表示不需要登录，使用已有session
	if err != nil {
		return nil, nil, errors.Wrap(err, "create telegram client")
	}

	return client, storageInstance, nil
}

// getOrCreateClientID 获取客户端ID，与AuthHandler保持一致的识别机制
func (h *UploadHandler) getOrCreateClientID(c *gin.Context) (string, error) {
	const clientIDCookie = "tdl_client_id"
	const clientIDHeader = "X-TDL-Client-ID"
	
	// 1. 优先从Cookie获取客户端ID
	if clientID, err := c.Cookie(clientIDCookie); err == nil && clientID != "" {
		return clientID, nil
	}
	
	// 2. 从Header获取客户端ID
	if clientID := c.GetHeader(clientIDHeader); clientID != "" {
		// 设置cookie以便后续请求使用
		c.SetCookie(clientIDCookie, clientID, 30*24*3600, "/", "", false, true) // 30天
		return clientID, nil
	}
	
	// 3. 从旧Header获取（向后兼容）
	if clientID := c.GetHeader("X-Session-ID"); clientID != "" {
		return clientID, nil
	}
	
	// 4. 回退到IP地址（与Auth处理保持一致）
	clientIP := c.ClientIP()
	if clientIP == "" {
		return "", errors.New("cannot identify client")
	}
	return util.SafeClientID(clientIP), nil
}

func (h *UploadHandler) generateShortID() string {
	bytes := make([]byte, 3)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func (h *UploadHandler) createTempDir(taskID string) (string, error) {
	tempDir := filepath.Join(os.TempDir(), "tdl_upload", taskID)
	return tempDir, os.MkdirAll(tempDir, 0755)
}

func (h *UploadHandler) saveUploadedFile(fileHeader *multipart.FileHeader, dst string) error {
	src, err := fileHeader.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, src)
	return err
}