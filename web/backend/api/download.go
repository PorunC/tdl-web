package api

import (
	"context"

	"github.com/gin-gonic/gin"

	"github.com/iyear/tdl/core/storage"
	"github.com/iyear/tdl/web/backend/websocket"
)

type DownloadHandler struct {
	ctx   context.Context
	kvd   storage.Storage
	wsHub *websocket.Hub
}

func NewDownloadHandler(ctx context.Context, kvd storage.Storage, wsHub *websocket.Hub) *DownloadHandler {
	return &DownloadHandler{
		ctx:   ctx,
		kvd:   kvd,
		wsHub: wsHub,
	}
}

// GetChats 获取聊天列表
func (h *DownloadHandler) GetChats(c *gin.Context) {
	// 模拟聊天数据
	chats := []map[string]interface{}{
		{
			"id":    "123456789",
			"title": "测试群组",
			"type":  "group",
			"count": 100,
		},
		{
			"id":    "987654321",
			"title": "个人聊天",
			"type":  "private",
			"count": 50,
		},
	}

	Success(c, chats)
}

// StartDownload 开始下载任务
func (h *DownloadHandler) StartDownload(c *gin.Context) {
	var req struct {
		ChatID    string   `json:"chat_id" binding:"required"`
		FileTypes []string `json:"file_types"`
		Filter    string   `json:"filter"`
		Dir       string   `json:"dir"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 模拟启动下载任务
	go func() {
		// 模拟任务进度
		h.wsHub.BroadcastProgress(websocket.ProgressData{
			TaskID:      req.ChatID,
			Progress:    50.0,
			Speed:       "2.3 MB/s",
			ETA:         "5m 32s",
			Transferred: 104857600,
			Total:       230686720,
		})
	}()

	SuccessWithMessage(c, map[string]string{
		"task_id": req.ChatID,
	}, "Download task started")
}

// GetTasks 获取下载任务列表
func (h *DownloadHandler) GetTasks(c *gin.Context) {
	// 模拟任务数据
	tasks := []map[string]interface{}{
		{
			"id":          "task-1",
			"type":        "download",
			"name":        "群组文件下载",
			"status":      "running",
			"progress":    45.5,
			"speed":       "2.3 MB/s",
			"eta":         "5m 32s",
			"transferred": 104857600,
			"total":       230686720,
			"created_at":  "2024-01-01T10:00:00Z",
		},
	}

	Success(c, map[string]interface{}{
		"tasks": tasks,
		"total": 1,
	})
}

// CancelTask 取消下载任务
func (h *DownloadHandler) CancelTask(c *gin.Context) {
	taskID := c.Param("id")
	if taskID == "" {
		ValidationError(c, "task ID is required")
		return
	}

	// 模拟取消操作
	h.wsHub.BroadcastTaskStatus(websocket.MessageTypeTaskEnd, websocket.TaskData{
		TaskID:   taskID,
		TaskType: "download",
		Status:   "cancelled",
		Message:  "Task cancelled by user",
	})

	SuccessWithMessage(c, nil, "Task cancelled successfully")
}