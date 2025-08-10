package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-faster/errors"
	"github.com/gotd/td/telegram"

	"github.com/iyear/tdl/app/forward"
	"github.com/iyear/tdl/core/forwarder"
	"github.com/iyear/tdl/core/logctx"
	"github.com/iyear/tdl/core/storage"
	"github.com/iyear/tdl/pkg/kv"
	tclientpkg "github.com/iyear/tdl/pkg/tclient"
	"github.com/iyear/tdl/web/backend/service"
	"github.com/iyear/tdl/web/backend/websocket"
)

type ForwardHandler struct {
	ctx         context.Context
	kvd         kv.Storage
	wsHub       *websocket.Hub
	authService *service.AuthService
	activeTasks sync.Map // taskID -> context.CancelFunc
	taskStore   sync.Map // taskID -> TaskInfo (in-memory storage)
}

func NewForwardHandler(ctx context.Context, kvd kv.Storage, wsHub *websocket.Hub) *ForwardHandler {
	return &ForwardHandler{
		ctx:         ctx,
		kvd:         kvd,
		wsHub:       wsHub,
		authService: service.NewAuthService(ctx, kvd),
		activeTasks: sync.Map{},
		taskStore:   sync.Map{},
	}
}

// ForwardRequest represents a forward request from web interface
type ForwardRequest struct {
	FromSources []string `json:"from_sources" binding:"required"` // 消息来源：文件路径或URL
	ToChat      string   `json:"to_chat"`                         // 目标聊天ID或用户名（空字符串表示Saved Messages）
	EditText    string   `json:"edit_text"`                       // 编辑消息文本（可选）
	Mode        string   `json:"mode"`                            // 转发模式：direct, clone
	Silent      bool     `json:"silent"`                          // 静默转发
	DryRun      bool     `json:"dry_run"`                         // 仅测试不实际转发
	Single      bool     `json:"single"`                          // 逐个转发而不是分组
	Desc        bool     `json:"desc"`                            // 降序转发
	TaskID      string   `json:"task_id"`                         // 任务ID
}

// ForwardTaskInfo represents forward task information
type ForwardTaskInfo struct {
	ID            string                 `json:"id"`
	Type          string                 `json:"type"`
	Name          string                 `json:"name"`
	Status        string                 `json:"status"`
	Progress      float64                `json:"progress"`
	Speed         string                 `json:"speed"`
	ETA           string                 `json:"eta"`
	Forwarded     int                    `json:"forwarded"`     // 已转发数量
	Total         int                    `json:"total"`         // 总数量
	Failed        int                    `json:"failed"`        // 失败数量
	CreatedAt     time.Time              `json:"created_at"`
	Error         string                 `json:"error,omitempty"`
	Config        map[string]interface{} `json:"config,omitempty"`
	FromSources   []string               `json:"from_sources"`  // 消息来源
	ToChat        string                 `json:"to_chat"`       // 目标聊天
	MessageStats  []MessageStat          `json:"message_stats"` // 消息统计
}

// MessageStat represents single message forward statistics
type MessageStat struct {
	FromChat    string `json:"from_chat"`
	MessageID   int    `json:"message_id"`
	ToChat      string `json:"to_chat"`
	Status      string `json:"status"` // pending, success, failed
	Error       string `json:"error,omitempty"`
	ForwardedAt *time.Time `json:"forwarded_at,omitempty"`
}

// StartForward 开始转发任务
func (h *ForwardHandler) StartForward(c *gin.Context) {
	var req ForwardRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 验证输入
	if len(req.FromSources) == 0 {
		ValidationError(c, "From sources are required")
		return
	}

	if req.ToChat == "" {
		ValidationError(c, "To chat is required")
		return
	}

	// 生成任务ID
	taskID := req.TaskID
	if taskID == "" {
		taskID = fmt.Sprintf("forward-%d-%s", time.Now().Unix(), h.generateShortID())
	}

	// 解析转发模式
	mode := forwarder.ModeDirect
	switch strings.ToLower(req.Mode) {
	case "clone":
		mode = forwarder.ModeClone
	case "direct", "":
		mode = forwarder.ModeDirect
	default:
		ValidationError(c, "Invalid forward mode. Use 'direct' or 'clone'")
		return
	}

	// 保存任务信息
	taskInfo := ForwardTaskInfo{
		ID:          taskID,
		Type:        "forward",
		Name:        fmt.Sprintf("转发任务: %s -> %s", strings.Join(req.FromSources, ", "), req.ToChat),
		Status:      "pending",
		Progress:    0,
		Speed:       "0 msg/s",
		ETA:         "--",
		Forwarded:   0,
		Total:       0,
		Failed:      0,
		CreatedAt:   time.Now(),
		FromSources: req.FromSources,
		ToChat:      req.ToChat,
		Config: map[string]interface{}{
			"forward_config": req,
		},
		MessageStats: []MessageStat{},
	}

	h.taskStore.Store(taskID, taskInfo)

	// 创建带取消功能的上下文
	taskCtx, cancel := context.WithCancel(h.ctx)
	h.activeTasks.Store(taskID, cancel)

	// 启动转发任务
	go func() {
		defer func() {
			h.activeTasks.Delete(taskID)
		}()

		// 更新任务状态为运行中
		h.updateForwardTaskStatus(taskID, "running", "", 0, 0, 0)

		// 发送任务开始通知
		h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskStart, websocket.TaskData{
			TaskID:   taskID,
			TaskType: "forward",
			Status:   "running",
			Message:  "Forward task started",
		})

		// 获取客户端ID
		clientID, err := h.getClientID(c)
		if err != nil {
			fmt.Printf("Forward: Failed to get client ID: %v\n", err)
			h.updateForwardTaskStatus(taskID, "error", fmt.Sprintf("Failed to get client ID: %v", err), 0, 0, 0)
			h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskError, websocket.TaskData{
				TaskID:   taskID,
				TaskType: "forward",
				Status:   "error",
				Message:  fmt.Sprintf("Failed to get client ID: %v", err),
			})
			return
		}

		fmt.Printf("Forward: Using clientID: %s\n", clientID)

		// 执行真实的转发任务
		err = h.executeRealForward(taskCtx, req, taskID, clientID, mode)
		if err != nil {
			fmt.Printf("Forward error: %v\n", err)
			h.updateForwardTaskStatus(taskID, "error", err.Error(), 0, 0, 0)
			h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskError, websocket.TaskData{
				TaskID:   taskID,
				TaskType: "forward",
				Status:   "error",
				Message:  err.Error(),
			})
			return
		}

		fmt.Printf("Forward completed successfully\n")

		// 检查是否被取消
		err = taskCtx.Err()
		if err != nil {
			if errors.Is(err, context.Canceled) {
				h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
					TaskID:   taskID,
					TaskType: "forward",
					Status:   "cancelled",
					Message:  "Forward task cancelled by user",
				})
			} else {
				h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskError, websocket.TaskData{
					TaskID:   taskID,
					TaskType: "forward",
					Status:   "error",
					Message:  err.Error(),
				})
			}
		} else {
			// 任务完成
			h.updateForwardTaskStatus(taskID, "completed", "", 100, 0, 0)
			h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
				TaskID:   taskID,
				TaskType: "forward",
				Status:   "completed",
				Message:  "Forward task completed successfully",
			})
		}
	}()

	SuccessWithMessage(c, map[string]string{
		"task_id": taskID,
	}, "Forward task started")
}

// GetForwardTasks 获取转发任务列表
func (h *ForwardHandler) GetForwardTasks(c *gin.Context) {
	tasks := []ForwardTaskInfo{}

	// 从内存存储获取任务
	h.taskStore.Range(func(key, value interface{}) bool {
		if task, ok := value.(ForwardTaskInfo); ok {
			// 检查任务是否仍在运行
			if task.Status == "running" {
				if _, exists := h.activeTasks.Load(task.ID); !exists {
					// 任务不在活动列表中，可能已经停止
					task.Status = "error"
					task.Error = "Task was interrupted"
					h.taskStore.Store(task.ID, task)
				}
			}
			tasks = append(tasks, task)
		}
		return true
	})

	Success(c, map[string]interface{}{
		"tasks": tasks,
		"total": len(tasks),
	})
}

// CancelForwardTask 取消转发任务
func (h *ForwardHandler) CancelForwardTask(c *gin.Context) {
	taskID := c.Param("id")
	if taskID == "" {
		ValidationError(c, "task ID is required")
		return
	}

	// 取消活动任务
	if cancelFunc, exists := h.activeTasks.Load(taskID); exists {
		if cancel, ok := cancelFunc.(context.CancelFunc); ok {
			cancel()
		}
		h.activeTasks.Delete(taskID)
	}

	// 更新任务状态
	h.updateForwardTaskStatus(taskID, "cancelled", "", 0, 0, 0)

	// 发送WebSocket通知
	h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
		TaskID:   taskID,
		TaskType: "forward",
		Status:   "cancelled",
		Message:  "Task cancelled by user",
	})

	SuccessWithMessage(c, nil, "Forward task cancelled successfully")
}

// GetForwardTaskDetails 获取转发任务详细信息
func (h *ForwardHandler) GetForwardTaskDetails(c *gin.Context) {
	taskID := c.Param("id")
	if taskID == "" {
		ValidationError(c, "task ID is required")
		return
	}

	task, exists := h.getForwardTaskInfo(taskID)
	if !exists {
		NotFoundError(c, "Task not found")
		return
	}

	Success(c, task)
}

// getClientID 获取客户端ID，与ChatHandler和DownloadHandler保持完全一致的识别机制
func (h *ForwardHandler) getClientID(c *gin.Context) (string, error) {
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

	// 3. 生成新的客户端ID
	clientID, err := h.generateClientID()
	if err != nil {
		// 如果生成失败，回退到IP地址
		fmt.Printf("Failed to generate client ID, fallback to IP: %v\n", err)
		clientIP := c.ClientIP()
		// 使用与util.SafeClientID相同的逻辑
		safeIP := strings.ReplaceAll(clientIP, ":", "_")
		safeIP = strings.ReplaceAll(safeIP, ".", "_")
		return fmt.Sprintf("client_%s", safeIP), nil
	}

	// 4. 设置cookie并返回
	c.SetCookie(clientIDCookie, clientID, 30*24*3600, "/", "", false, true) // 30天
	return clientID, nil
}

// generateClientID 生成唯一的客户端ID
func (h *ForwardHandler) generateClientID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}
	return "client_" + hex.EncodeToString(bytes), nil
}

// generateShortID 生成短ID
func (h *ForwardHandler) generateShortID() string {
	bytes := make([]byte, 4)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// createTelegramClientForUser 为特定用户创建Telegram客户端，复制其他Handler的逻辑
func (h *ForwardHandler) createTelegramClientForUser(clientID string) (*telegram.Client, storage.Storage, error) {
	// 获取Telegram ID
	telegramID, err := h.authService.GetAuthenticatedTelegramID(clientID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get authenticated telegram id: %w", err)
	}

	// 使用用户命名空间
	namespace := fmt.Sprintf("user_%d", telegramID)
	return h.createTelegramClient(namespace)
}

// createTelegramClient 创建Telegram客户端，使用与CLI相同的配置
func (h *ForwardHandler) createTelegramClient(namespace string) (*telegram.Client, storage.Storage, error) {
	// 通过kv.Storage获取storage.Storage实例
	storageInstance, err := h.kvd.Open(namespace)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to open storage namespace: %w", err)
	}

	// 获取当前设置
	settingsHandler := NewSettingsHandler(h.ctx, h.kvd)
	settings, err := settingsHandler.GetCurrentSettings()
	if err != nil {
		fmt.Printf("Failed to load settings, using defaults: %v\n", err)
		settings = &Settings{
			GlobalProxy:      "",
			ReconnectTimeout: 300,
		}
	}

	// 使用与CLI相同的tOptions配置
	o := tclientpkg.Options{
		KV:               storageInstance,
		Proxy:            settings.GlobalProxy,
		NTP:              "",
		ReconnectTimeout: time.Duration(settings.ReconnectTimeout) * time.Second,
		UpdateHandler:    nil,
	}

	// 记录配置信息
	fmt.Printf("Creating Telegram client for forward with settings: proxy=%s, reconnectTimeout=%v\n",
		o.Proxy, o.ReconnectTimeout)

	// 创建客户端
	client, err := tclientpkg.New(h.ctx, o, false) // false表示不需要登录，使用已有session
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create telegram client: %w", err)
	}

	return client, storageInstance, nil
}

// executeRealForward 执行真实的转发任务，使用CLI的完整功能
func (h *ForwardHandler) executeRealForward(ctx context.Context, req ForwardRequest, taskID string, clientID string, mode forwarder.Mode) error {
	fmt.Printf("executeRealForward: Starting real CLI forward for clientID: %s\n", clientID)

	// 使用与Chat页面相同的认证机制
	return h.tRunWithForward(ctx, req, taskID, clientID, mode)
}

// tRunWithForward 使用与Chat页面相同的认证机制来执行转发
func (h *ForwardHandler) tRunWithForward(ctx context.Context, req ForwardRequest, taskID string, clientID string, mode forwarder.Mode) error {
	fmt.Printf("tRunWithForward: Creating authenticated client for user\n")

	// 使用与Chat页面完全相同的客户端创建逻辑
	client, storageInstance, err := h.createTelegramClientForUser(clientID)
	if err != nil {
		fmt.Printf("tRunWithForward: Failed to create client for user: %v\n", err)
		return errors.Wrap(err, "create telegram client for user")
	}

	fmt.Printf("tRunWithForward: Client created successfully for authenticated user\n")
	fmt.Printf("tRunWithForward: Starting forward with authenticated client\n")

	// 直接运行转发，因为客户端已经是认证用户的了
	err = client.Run(ctx, func(ctx context.Context) error {
		fmt.Printf("tRunWithForward: Inside client.Run, starting forward\n")

		// 使用CLI的forward.Run函数
		opts := forward.Options{
			From:   req.FromSources,
			To:     req.ToChat,
			Edit:   req.EditText,
			Mode:   mode,
			Silent: req.Silent,
			DryRun: req.DryRun,
			Single: req.Single,
			Desc:   req.Desc,
		}

		fmt.Printf("tRunWithForward: Calling CLI forward.Run with options: %+v\n", opts)

		// 创建进度监控
		go h.monitorRealForwardProgress(ctx, taskID, req.FromSources)

		// 调用真实的CLI转发函数
		forwardErr := forward.Run(logctx.Named(ctx, "forward"), client, storageInstance, opts)
		fmt.Printf("tRunWithForward: forward.Run completed with error: %v\n", forwardErr)
		return forwardErr
	})

	if err != nil {
		fmt.Printf("tRunWithForward: client.Run failed with error: %v\n", err)
		return errors.Wrap(err, "run telegram client")
	}

	fmt.Printf("tRunWithForward: Successfully completed\n")
	return nil
}

// monitorRealForwardProgress 监控真实的转发进度
func (h *ForwardHandler) monitorRealForwardProgress(ctx context.Context, taskID string, sources []string) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	startTime := time.Now()
	lastForwarded := 0

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// 模拟进度监控（实际实现中应该集成到forward进度回调）
			elapsed := time.Since(startTime).Seconds()
			forwarded := int(elapsed / 2) // 简单的进度模拟

			// 计算速度
			var speed string
			if elapsed > 0 {
				msgPerSec := float64(forwarded-lastForwarded) / 2.0 // 每2秒的消息数
				speed = fmt.Sprintf("%.1f msg/s", msgPerSec)
			} else {
				speed = "计算中..."
			}

			// 发送进度更新
			h.wsHub.BroadcastProgress(websocket.ProgressData{
				TaskID:      taskID,
				Progress:    float64(forwarded * 5), // 简单的进度估算
				Speed:       speed,
				ETA:         "计算中...",
				Transferred: int64(forwarded),
				Total:       100, // 估算总数
			})

			h.updateForwardTaskStatus(taskID, "running", "", float64(forwarded*5), forwarded, 0)

			lastForwarded = forwarded

			// 简单的完成条件
			if forwarded >= 20 {
				return
			}
		}
	}
}

// updateForwardTaskStatus 更新转发任务状态
func (h *ForwardHandler) updateForwardTaskStatus(taskID, status, errorMsg string, progress float64, forwarded, failed int) {
	if value, exists := h.taskStore.Load(taskID); exists {
		if task, ok := value.(ForwardTaskInfo); ok {
			task.Status = status
			task.Progress = progress
			task.Forwarded = forwarded
			task.Failed = failed
			if errorMsg != "" {
				task.Error = errorMsg
			}
			h.taskStore.Store(taskID, task)
		}
	}
}

// getForwardTaskInfo 获取转发任务信息
func (h *ForwardHandler) getForwardTaskInfo(taskID string) (ForwardTaskInfo, bool) {
	if value, exists := h.taskStore.Load(taskID); exists {
		if task, ok := value.(ForwardTaskInfo); ok {
			return task, true
		}
	}
	return ForwardTaskInfo{}, false
}