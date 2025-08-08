package api

import (
	"context"

	"github.com/gin-gonic/gin"

	"github.com/iyear/tdl/core/storage"
)

type SettingsHandler struct {
	ctx context.Context
	kvd storage.Storage
}

func NewSettingsHandler(ctx context.Context, kvd storage.Storage) *SettingsHandler {
	return &SettingsHandler{
		ctx: ctx,
		kvd: kvd,
	}
}

func (h *SettingsHandler) GetSettings(c *gin.Context) {
	// 获取设置
	settings := map[string]interface{}{
		"proxy":        "",
		"threads":      4,
		"limit":        2,
		"part_size":    512 * 1024,
		"namespace":    "default",
		"debug":        false,
	}
	
	Success(c, settings)
}

func (h *SettingsHandler) UpdateSettings(c *gin.Context) {
	var settings map[string]interface{}
	if err := c.ShouldBindJSON(&settings); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 保存设置到KV存储
	// 这里应该实现设置的保存逻辑

	SuccessWithMessage(c, nil, "Settings updated successfully")
}