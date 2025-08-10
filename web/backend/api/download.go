package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-faster/errors"
	"github.com/gotd/td/telegram"

	"github.com/iyear/tdl/app/dl"
	"github.com/iyear/tdl/core/logctx"
	"github.com/iyear/tdl/core/storage"
	"github.com/iyear/tdl/pkg/kv"
	tclientpkg "github.com/iyear/tdl/pkg/tclient"
	"github.com/iyear/tdl/web/backend/service"
	"github.com/iyear/tdl/web/backend/websocket"
)

type DownloadHandler struct {
	ctx         context.Context
	kvd         kv.Storage
	wsHub       *websocket.Hub
	authService *service.AuthService
	activeTasks sync.Map // taskID -> context.CancelFunc
	taskStore   sync.Map // taskID -> TaskInfo (in-memory storage)
}

func NewDownloadHandler(ctx context.Context, kvd kv.Storage, wsHub *websocket.Hub) *DownloadHandler {
	return &DownloadHandler{
		ctx:         ctx,
		kvd:         kvd,
		wsHub:       wsHub,
		authService: service.NewAuthService(ctx, kvd),
		activeTasks: sync.Map{},
		taskStore:   sync.Map{},
	}
}

// DownloadRequest represents a download request
type DownloadRequest struct {
	ChatID       string   `json:"chat_id"`
	FileTypes    []string `json:"file_types"`
	Filter       string   `json:"filter"`
	DownloadPath string   `json:"download_path"`
	URLs         []string `json:"urls"`
	Template     string   `json:"template"`
	Include      []string `json:"include"`
	Exclude      []string `json:"exclude"`
	Takeout      bool     `json:"takeout"`
	Continue     bool     `json:"continue"`
	Desc         bool     `json:"desc"`
	TaskID       string   `json:"task_id"`
}

// ImportRequest represents a JSON import request
type ImportRequest struct {
	ChatID             string   `json:"chat_id" binding:"required"`
	DownloadPath       string   `json:"download_path" binding:"required"`
	Template           string   `json:"template"`
	JsonData           any      `json:"json_data" binding:"required"`
	SelectedMessageIds []int    `json:"selected_message_ids"`
	TaskID             string   `json:"task_id" binding:"required"`
}

// TaskInfo represents the task information
type TaskInfo struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`
	Name        string                 `json:"name"`
	Status      string                 `json:"status"`
	Progress    float64                `json:"progress"`
	Speed       string                 `json:"speed"`
	ETA         string                 `json:"eta"`
	Transferred int64                  `json:"transferred"`
	Total       int64                  `json:"total"`
	CreatedAt   time.Time              `json:"created_at"`
	Error       string                 `json:"error,omitempty"`
	Config      map[string]interface{} `json:"config,omitempty"`
}


// StartDownload 开始下载任务
func (h *DownloadHandler) StartDownload(c *gin.Context) {
	var req DownloadRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 验证输入
	if len(req.URLs) == 0 && req.ChatID == "" {
		ValidationError(c, "Either URLs or chat_id is required")
		return
	}

	if req.DownloadPath == "" {
		ValidationError(c, "Download path is required")
		return
	}

	// 生成任务ID
	taskID := req.TaskID
	if taskID == "" {
		taskID = fmt.Sprintf("download-%d-%s", time.Now().Unix(), req.ChatID)
	}

	// 保存任务信息到内存存储
	taskInfo := TaskInfo{
		ID:        taskID,
		Type:      "download",
		Name:      fmt.Sprintf("下载任务 %s", taskID),
		Status:    "pending",
		Progress:  0,
		Speed:     "0 B/s",
		ETA:       "--",
		Total:     0,
		CreatedAt: time.Now(),
		Config: map[string]interface{}{
			"download_config": req,
		},
	}
	
	h.taskStore.Store(taskID, taskInfo)

	// 创建带取消功能的上下文
	taskCtx, cancel := context.WithCancel(h.ctx)
	h.activeTasks.Store(taskID, cancel)

	// 启动下载任务
	go func() {
		defer func() {
			h.activeTasks.Delete(taskID)
		}()

		// 更新任务状态为运行中
		h.updateTaskStatus(taskID, "running", "", 0)

		// 发送任务开始通知
		h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskStart, websocket.TaskData{
			TaskID:   taskID,
			TaskType: "download",
			Status:   "running",
			Message:  "Download task started",
		})

		// 模拟下载进度
		for i := 0; i <= 100; i += 10 {
			select {
			case <-taskCtx.Done():
				return
			default:
				time.Sleep(1 * time.Second)
				
				h.wsHub.BroadcastProgress(websocket.ProgressData{
					TaskID:      taskID,
					Progress:    float64(i),
					Speed:       "2.5 MB/s",
					ETA:         fmt.Sprintf("%ds", (100-i)/10),
					Transferred: int64(i * 1024 * 1024),
					Total:       100 * 1024 * 1024,
				})
				
				h.updateTaskStatus(taskID, "running", "", float64(i))
			}
		}
		
		// 检查是否被取消
		err := taskCtx.Err()
		if err != nil {
			if errors.Is(err, context.Canceled) {
				// 任务被取消
				h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
					TaskID:   taskID,
					TaskType: "download",
					Status:   "cancelled",
					Message:  "Task cancelled by user",
				})
			} else {
				// 任务出错
				h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskError, websocket.TaskData{
					TaskID:   taskID,
					TaskType: "download",
					Status:   "error",
					Message:  err.Error(),
				})
			}
		} else {
			// 任务完成
			h.updateTaskStatus(taskID, "completed", "", 100)
			h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
				TaskID:   taskID,
				TaskType: "download",
				Status:   "completed",
				Message:  "Download completed successfully",
			})
		}
	}()

	SuccessWithMessage(c, map[string]string{
		"task_id": taskID,
	}, "Download task started")
}

// GetTasks 获取下载任务列表
func (h *DownloadHandler) GetTasks(c *gin.Context) {
	tasks := []TaskInfo{}
	
	// 从内存存储获取任务
	h.taskStore.Range(func(key, value interface{}) bool {
		if task, ok := value.(TaskInfo); ok {
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

// CancelTask 取消下载任务
func (h *DownloadHandler) CancelTask(c *gin.Context) {
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
	h.updateTaskStatus(taskID, "cancelled", "", 0)

	// 发送WebSocket通知
	h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
		TaskID:   taskID,
		TaskType: "download",
		Status:   "cancelled",
		Message:  "Task cancelled by user",
	})

	SuccessWithMessage(c, nil, "Task cancelled successfully")
}

// updateTaskStatus 更新任务状态
func (h *DownloadHandler) updateTaskStatus(taskID, status, errorMsg string, progress float64) {
	if value, exists := h.taskStore.Load(taskID); exists {
		if task, ok := value.(TaskInfo); ok {
			task.Status = status
			task.Progress = progress
			if errorMsg != "" {
				task.Error = errorMsg
			}
			h.taskStore.Store(taskID, task)
		}
	}
}

// getTaskInfo 获取任务信息
func (h *DownloadHandler) getTaskInfo(taskID string) (TaskInfo, bool) {
	if value, exists := h.taskStore.Load(taskID); exists {
		if task, ok := value.(TaskInfo); ok {
			return task, true
		}
	}
	return TaskInfo{}, false
}

// PauseTask 暂停下载任务
func (h *DownloadHandler) PauseTask(c *gin.Context) {
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

	// 更新任务状态为暂停
	h.updateTaskStatus(taskID, "paused", "", 0)

	// 发送WebSocket通知
	h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
		TaskID:   taskID,
		TaskType: "download",
		Status:   "paused",
		Message:  "Task paused by user",
	})

	SuccessWithMessage(c, nil, "Task paused successfully")
}

// ResumeTask 恢复下载任务
func (h *DownloadHandler) ResumeTask(c *gin.Context) {
	taskID := c.Param("id")
	if taskID == "" {
		ValidationError(c, "task ID is required")
		return
	}

	// 获取任务信息
	task, exists := h.getTaskInfo(taskID)
	if !exists {
		NotFoundError(c, "Task not found")
		return
	}

	if task.Status != "paused" {
		ValidationError(c, "Task is not in paused state")
		return
	}

	// 重启下载任务
	h.updateTaskStatus(taskID, "running", "", task.Progress)
	
	h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskStart, websocket.TaskData{
		TaskID:   taskID,
		TaskType: "download",
		Status:   "running",
		Message:  "Task resumed",
	})

	SuccessWithMessage(c, nil, "Task resumed successfully")
}

// RetryTask 重试下载任务
func (h *DownloadHandler) RetryTask(c *gin.Context) {
	taskID := c.Param("id")
	if taskID == "" {
		ValidationError(c, "task ID is required")
		return
	}

	// 重置任务状态
	h.updateTaskStatus(taskID, "pending", "", 0)

	// 发送WebSocket通知
	h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskStart, websocket.TaskData{
		TaskID:   taskID,
		TaskType: "download",
		Status:   "pending",
		Message:  "Task queued for retry",
	})

	SuccessWithMessage(c, nil, "Task queued for retry")
}

// GetTaskDetails 获取任务详细信息
func (h *DownloadHandler) GetTaskDetails(c *gin.Context) {
	taskID := c.Param("id")
	if taskID == "" {
		ValidationError(c, "task ID is required")
		return
	}

	task, exists := h.getTaskInfo(taskID)
	if !exists {
		NotFoundError(c, "Task not found")
		return
	}

	Success(c, task)
}

// getClientID 获取客户端ID，与ChatHandler保持完全一致的识别机制  
func (h *DownloadHandler) getClientID(c *gin.Context) (string, error) {
	// 复制ChatHandler的完整 getOrCreateClientID 逻辑
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

// generateClientID 生成唯一的客户端ID - 复制ChatHandler的实现
func (h *DownloadHandler) generateClientID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}
	return "client_" + hex.EncodeToString(bytes), nil
}

// convertTemplateFormat 将前端模板格式转换为Go template格式
// 从 {DialogID} 转换为 {{ .DialogID }}
func (h *DownloadHandler) convertTemplateFormat(template string) string {
	if template == "" {
		return "{{ .DialogID }}_{{ .MessageID }}_{{ filenamify .FileName }}"
	}
	
	// 如果已经是正确的Go模板格式，直接返回
	if strings.Contains(template, "{{") && strings.Contains(template, "}}") {
		return template
	}
	
	// 转换常见的模板变量
	converted := template
	converted = strings.ReplaceAll(converted, "{DialogID}", "{{ .DialogID }}")
	converted = strings.ReplaceAll(converted, "{MessageID}", "{{ .MessageID }}")
	converted = strings.ReplaceAll(converted, "{FileName}", "{{ filenamify .FileName }}")
	converted = strings.ReplaceAll(converted, "{FileSize}", "{{ .FileSize }}")
	converted = strings.ReplaceAll(converted, "{MessageDate}", "{{ .MessageDate }}")
	converted = strings.ReplaceAll(converted, "{DownloadDate}", "{{ .DownloadDate }}")
	converted = strings.ReplaceAll(converted, "{FileCaption}", "{{ .FileCaption }}")
	
	fmt.Printf("Template conversion: '%s' -> '%s'\n", template, converted)
	return converted
}

// createTelegramClientForUser 为特定用户创建Telegram客户端，复制ChatHandler的逻辑
func (h *DownloadHandler) createTelegramClientForUser(clientID string) (*telegram.Client, storage.Storage, error) {
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
func (h *DownloadHandler) createTelegramClient(namespace string) (*telegram.Client, storage.Storage, error) {
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
		Proxy:            settings.GlobalProxy, // 从设置中获取代理配置
		NTP:              "", // NTP配置暂时为空
		ReconnectTimeout: time.Duration(settings.ReconnectTimeout) * time.Second, // 从设置中获取重连超时
		UpdateHandler:    nil,
	}

	// 记录配置信息
	fmt.Printf("Creating Telegram client with settings: proxy=%s, reconnectTimeout=%v\n", 
		o.Proxy, o.ReconnectTimeout)

	// 创建客户端，使用与CLI相同的参数
	client, err := tclientpkg.New(h.ctx, o, false) // false表示不需要登录，使用已有session
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create telegram client: %w", err)
	}

	return client, storageInstance, nil
}

// ImportFromJson 从JSON文件导入并开始下载 - 使用CLI的完整功能
func (h *DownloadHandler) ImportFromJson(c *gin.Context) {
	var req ImportRequest

	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 验证JSON数据结构
	jsonMap, ok := req.JsonData.(map[string]interface{})
	if !ok {
		ValidationError(c, "Invalid JSON data format")
		return
	}

	// 验证JSON包含必要字段
	if _, hasId := jsonMap["id"]; !hasId {
		ValidationError(c, "JSON missing required 'id' field")
		return
	}

	messages, hasMessages := jsonMap["messages"]
	if !hasMessages {
		ValidationError(c, "JSON missing required 'messages' field")
		return
	}

	messagesArray, ok := messages.([]interface{})
	if !ok {
		ValidationError(c, "Invalid messages format in JSON")
		return
	}

	// 创建临时JSON文件供后端处理
	tempDir := os.TempDir()
	tempFile := filepath.Join(tempDir, fmt.Sprintf("import_%s_%d.json", req.TaskID, time.Now().Unix()))
	
	// 如果指定了选中的消息ID，过滤JSON数据
	if len(req.SelectedMessageIds) > 0 {
		selectedIdMap := make(map[int]bool)
		for _, id := range req.SelectedMessageIds {
			selectedIdMap[id] = true
		}
		
		filteredMessages := []interface{}{}
		for _, msg := range messagesArray {
			if msgMap, ok := msg.(map[string]interface{}); ok {
				if idFloat, hasId := msgMap["id"]; hasId {
					if id, ok := idFloat.(float64); ok {
						if selectedIdMap[int(id)] {
							filteredMessages = append(filteredMessages, msg)
						}
					}
				}
			}
		}
		
		// 更新JSON数据为过滤后的消息
		jsonMap["messages"] = filteredMessages
	}

	// 写入临时文件
	jsonBytes, err := json.Marshal(jsonMap)
	if err != nil {
		InternalError(c, "Failed to serialize JSON data", err)
		return
	}

	if err := os.WriteFile(tempFile, jsonBytes, 0644); err != nil {
		InternalError(c, "Failed to create temporary file", err)
		return
	}
	
	// 调试：输出临时文件内容
	fmt.Printf("Created temp file: %s\n", tempFile)
	fmt.Printf("JSON content: %s\n", string(jsonBytes))

	// 确保在任务完成后清理临时文件
	defer func() {
		go func() {
			time.Sleep(1 * time.Hour) // 1小时后清理
			os.Remove(tempFile)
		}()
	}()

	// 保存任务信息
	taskInfo := TaskInfo{
		ID:        req.TaskID,
		Type:      "download",
		Name:      fmt.Sprintf("导入下载: Chat %s (%d个文件)", req.ChatID, len(req.SelectedMessageIds)),
		Status:    "pending",
		Progress:  0,
		Speed:     "0 B/s",
		ETA:       "--",
		Total:     0,
		CreatedAt: time.Now(),
		Config: map[string]interface{}{
			"import_config": req,
			"temp_file":     tempFile,
		},
	}
	
	h.taskStore.Store(req.TaskID, taskInfo)

	// 创建带取消功能的上下文
	taskCtx, cancel := context.WithCancel(h.ctx)
	h.activeTasks.Store(req.TaskID, cancel)

	// 启动导入下载任务
	go func() {
		defer func() {
			h.activeTasks.Delete(req.TaskID)
		}()

		// 更新任务状态为运行中
		h.updateTaskStatus(req.TaskID, "running", "", 0)

		// 发送任务开始通知
		h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskStart, websocket.TaskData{
			TaskID:   req.TaskID,
			TaskType: "download",
			Status:   "running",
			Message:  "Import download task started",
		})

		// 调用真实的tdl CLI下载功能
		fmt.Printf("Starting download with temp file: %s\n", tempFile)
		fmt.Printf("Download path: %s\n", req.DownloadPath)
		fmt.Printf("Original Template: %s\n", req.Template)
		
		// 自动转换模板格式：从 {xxx} 转换为 {{ .xxx }}
		template := h.convertTemplateFormat(req.Template)
		fmt.Printf("Converted Template: %s\n", template)
		
		// 获取客户端ID
		clientID, err := h.getClientID(c)
		if err != nil {
			fmt.Printf("Failed to get client ID: %v\n", err)
			h.updateTaskStatus(req.TaskID, "error", fmt.Sprintf("Failed to get client ID: %v", err), 0)
			h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskError, websocket.TaskData{
				TaskID:   req.TaskID,
				TaskType: "download",
				Status:   "error",
				Message:  fmt.Sprintf("Failed to get client ID: %v", err),
			})
			return
		}
		fmt.Printf("Using clientID: %s\n", clientID)
		
		err = h.executeRealDownload(taskCtx, req, tempFile, clientID, template)
		if err != nil {
			fmt.Printf("Download error: %v\n", err)
			h.updateTaskStatus(req.TaskID, "error", err.Error(), 0)
			h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskError, websocket.TaskData{
				TaskID:   req.TaskID,
				TaskType: "download",
				Status:   "error",
				Message:  err.Error(),
			})
			return
		}
		
		fmt.Printf("Download completed successfully\n")
		
		// 检查是否被取消
		err = taskCtx.Err()
		if err != nil {
			if errors.Is(err, context.Canceled) {
				h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
					TaskID:   req.TaskID,
					TaskType: "download",
					Status:   "cancelled",
					Message:  "Import task cancelled by user",
				})
			} else {
				h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskError, websocket.TaskData{
					TaskID:   req.TaskID,
					TaskType: "download",
					Status:   "error",
					Message:  err.Error(),
				})
			}
		} else {
			// 任务完成
			h.updateTaskStatus(req.TaskID, "completed", "", 100)
			h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
				TaskID:   req.TaskID,
				TaskType: "download",
				Status:   "completed",
				Message:  "Import download completed successfully",
			})
		}
	}()

	SuccessWithMessage(c, map[string]string{
		"task_id": req.TaskID,
	}, "Import download task started")
}

// executeRealDownload 执行真实的下载任务，使用CLI的完整功能
func (h *DownloadHandler) executeRealDownload(ctx context.Context, req ImportRequest, tempFile string, clientID string, template string) error {
	fmt.Printf("executeRealDownload: Starting real CLI download for clientID: %s\n", clientID)
	
	// 使用与Chat页面相同的认证机制
	return h.tRunWithFiles(ctx, req, tempFile, clientID, template)
}

// tRunWithFiles 使用与Chat页面相同的认证机制来执行下载
func (h *DownloadHandler) tRunWithFiles(ctx context.Context, req ImportRequest, tempFile string, clientID string, template string) error {
	fmt.Printf("tRunWithFiles: Creating authenticated client for user\n")
	
	// 使用与Chat页面完全相同的客户端创建逻辑
	client, storageInstance, err := h.createTelegramClientForUser(clientID)
	if err != nil {
		fmt.Printf("tRunWithFiles: Failed to create client for user: %v\n", err)
		return errors.Wrap(err, "create telegram client for user")
	}
	
	fmt.Printf("tRunWithFiles: Client created successfully for authenticated user\n")
	
	fmt.Printf("tRunWithFiles: Starting download with authenticated client\n")
	
	// 直接运行下载，因为客户端已经是认证用户的了
	err = client.Run(ctx, func(ctx context.Context) error {
		fmt.Printf("tRunWithFiles: Inside client.Run, starting download\n")
		
		// === 关键：直接使用CLI的dl.Run函数，但设置Continue=true避免交互 ===
		opts := dl.Options{
			Dir:         req.DownloadPath,
			RewriteExt:  false,
			SkipSame:    false,
			Template:    template, // 使用转换后的模板
			URLs:        []string{}, // JSON导入不使用URL
			Files:       []string{tempFile}, // 使用临时JSON文件
			Include:     []string{},
			Exclude:     []string{},
			Desc:        false,
			Takeout:     false,
			Group:       false,
			Continue:    true,  // 关键：避免交互式确认
			Restart:     false,
			Serve:       false,
			Port:        0,
		}
		
		fmt.Printf("tRunWithFiles: Calling CLI dl.Run with options: %+v\n", opts)
		
		// 创建进度监控
		go h.monitorRealDownloadProgress(ctx, req.TaskID, req.DownloadPath)
		
		// 调用真实的CLI下载函数，使用用户特定的存储
		dlErr := dl.Run(logctx.Named(ctx, "dl"), client, storageInstance, opts)
		fmt.Printf("tRunWithFiles: dl.Run completed with error: %v\n", dlErr)
		return dlErr
	})
	
	if err != nil {
		fmt.Printf("tRunWithFiles: client.Run failed with error: %v\n", err)
		return errors.Wrap(err, "run telegram client")
	}
	
	fmt.Printf("tRunWithFiles: Successfully completed\n")
	return nil
}

// monitorRealDownloadProgress 监控真实的下载进度
func (h *DownloadHandler) monitorRealDownloadProgress(ctx context.Context, taskID string, downloadDir string) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	
	startTime := time.Now()
	lastSize := int64(0)
	
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// 扫描下载目录获取进度
			fileCount, totalSize := h.scanDownloadDirectory(downloadDir)
			
			// 计算速度
			elapsed := time.Since(startTime).Seconds()
			var speed string
			if elapsed > 0 {
				bytesPerSec := float64(totalSize-lastSize) / elapsed
				if bytesPerSec > 1024*1024 {
					speed = fmt.Sprintf("%.1f MB/s", bytesPerSec/(1024*1024))
				} else if bytesPerSec > 1024 {
					speed = fmt.Sprintf("%.1f KB/s", bytesPerSec/1024)
				} else {
					speed = fmt.Sprintf("%.1f B/s", bytesPerSec)
				}
			} else {
				speed = "计算中..."
			}
			
			// 发送进度更新
			h.wsHub.BroadcastProgress(websocket.ProgressData{
				TaskID:      taskID,
				Progress:    float64(fileCount * 5), // 简单的进度估算
				Speed:       speed,
				ETA:         "计算中...",
				Transferred: totalSize,
				Total:       totalSize + 10*1024*1024, // 估算总大小
			})
			
			lastSize = totalSize
		}
	}
}

// scanDownloadDirectory 扫描下载目录统计文件数量和大小
func (h *DownloadHandler) scanDownloadDirectory(dir string) (fileCount int, totalSize int64) {
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // 忽略错误，继续扫描
		}
		if !info.IsDir() && filepath.Ext(info.Name()) != ".tmp" {
			fileCount++
			totalSize += info.Size()
		}
		return nil
	})
	return
}

