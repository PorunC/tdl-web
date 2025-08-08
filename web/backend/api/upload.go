package api

import (
	"context"

	"github.com/gin-gonic/gin"

	"github.com/iyear/tdl/core/storage"
	"github.com/iyear/tdl/web/backend/websocket"
)

type UploadHandler struct {
	ctx   context.Context
	kvd   storage.Storage
	wsHub *websocket.Hub
}

func NewUploadHandler(ctx context.Context, kvd storage.Storage, wsHub *websocket.Hub) *UploadHandler {
	return &UploadHandler{
		ctx:   ctx,
		kvd:   kvd,
		wsHub: wsHub,
	}
}

func (h *UploadHandler) StartUpload(c *gin.Context) {
	// 实现上传逻辑
	Success(c, map[string]string{"message": "upload started"})
}

func (h *UploadHandler) GetTasks(c *gin.Context) {
	// 获取上传任务
	Success(c, []interface{}{})
}

func (h *UploadHandler) CancelTask(c *gin.Context) {
	// 取消上传任务
	taskID := c.Param("id")
	SuccessWithMessage(c, nil, "Upload task "+taskID+" cancelled")
}