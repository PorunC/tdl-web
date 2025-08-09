package api

import (
	"context"
	"encoding/json"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/iyear/tdl/core/logctx"
	"github.com/iyear/tdl/pkg/kv"
)

type SettingsHandler struct {
	ctx     context.Context
	kvStore kv.Storage
}

func NewSettingsHandler(ctx context.Context, kvStore kv.Storage) *SettingsHandler {
	return &SettingsHandler{
		ctx:     ctx,
		kvStore: kvStore,
	}
}

// Settings 设置数据结构
type Settings struct {
	GlobalProxy       string `json:"globalProxy"`
	ReconnectTimeout  int    `json:"reconnectTimeout"`
	MaxThreads        int    `json:"maxThreads"`
	MaxTasks          int    `json:"maxTasks"`
	PartSize          int    `json:"partSize"`
}

// GetSettings 获取设置
func (h *SettingsHandler) GetSettings(c *gin.Context) {
	// 打开设置存储命名空间
	settingsStorage, err := h.kvStore.Open("settings")
	if err != nil {
		logctx.From(h.ctx).Error("Failed to open settings storage", zap.Error(err))
		InternalServerError(c, "Failed to open settings storage")
		return
	}

	// 获取设置数据
	data, err := settingsStorage.Get(c.Request.Context(), "global")
	if err != nil && !kv.IsNotFound(err) {
		logctx.From(h.ctx).Error("Failed to get settings", zap.Error(err))
		InternalServerError(c, "Failed to retrieve settings")
		return
	}

	// 默认设置
	settings := Settings{
		GlobalProxy:      "",
		ReconnectTimeout: 300,
		MaxThreads:       4,
		MaxTasks:         2,
		PartSize:         512,
	}

	// 如果存在保存的设置，解析JSON
	if data != nil {
		if err := json.Unmarshal(data, &settings); err != nil {
			logctx.From(h.ctx).Warn("Failed to parse settings JSON, using defaults", zap.Error(err))
		}
	}

	Success(c, settings)
}

// UpdateSettings 更新设置
func (h *SettingsHandler) UpdateSettings(c *gin.Context) {
	var settings Settings
	if err := c.ShouldBindJSON(&settings); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 验证设置值的有效性
	if settings.ReconnectTimeout < 0 {
		ValidationError(c, "Reconnect timeout must be non-negative")
		return
	}
	if settings.MaxThreads < 1 || settings.MaxThreads > 16 {
		ValidationError(c, "Max threads must be between 1 and 16")
		return
	}
	if settings.MaxTasks < 1 || settings.MaxTasks > 8 {
		ValidationError(c, "Max tasks must be between 1 and 8")
		return
	}
	if settings.PartSize < 64 || settings.PartSize > 2048 {
		ValidationError(c, "Part size must be between 64 and 2048 KB")
		return
	}

	// 打开设置存储命名空间
	settingsStorage, err := h.kvStore.Open("settings")
	if err != nil {
		logctx.From(h.ctx).Error("Failed to open settings storage", zap.Error(err))
		InternalServerError(c, "Failed to open settings storage")
		return
	}

	// 序列化设置为JSON
	data, err := json.Marshal(settings)
	if err != nil {
		logctx.From(h.ctx).Error("Failed to marshal settings", zap.Error(err))
		InternalServerError(c, "Failed to save settings")
		return
	}

	// 保存设置
	if err := settingsStorage.Set(c.Request.Context(), "global", data); err != nil {
		logctx.From(h.ctx).Error("Failed to save settings", zap.Error(err))
		InternalServerError(c, "Failed to save settings")
		return
	}

	logctx.From(h.ctx).Info("Settings updated successfully",
		zap.String("globalProxy", settings.GlobalProxy),
		zap.Int("reconnectTimeout", settings.ReconnectTimeout),
		zap.Int("maxThreads", settings.MaxThreads),
		zap.Int("maxTasks", settings.MaxTasks),
		zap.Int("partSize", settings.PartSize))

	SuccessWithMessage(c, settings, "Settings updated successfully")
}

// ResetSettings 重置设置为默认值
func (h *SettingsHandler) ResetSettings(c *gin.Context) {
	// 打开设置存储命名空间
	settingsStorage, err := h.kvStore.Open("settings")
	if err != nil {
		logctx.From(h.ctx).Error("Failed to open settings storage", zap.Error(err))
		InternalServerError(c, "Failed to open settings storage")
		return
	}

	// 删除现有设置
	if err := settingsStorage.Delete(c.Request.Context(), "global"); err != nil && !kv.IsNotFound(err) {
		logctx.From(h.ctx).Error("Failed to delete settings", zap.Error(err))
		InternalServerError(c, "Failed to reset settings")
		return
	}

	// 默认设置
	settings := Settings{
		GlobalProxy:      "",
		ReconnectTimeout: 300,
		MaxThreads:       4,
		MaxTasks:         2,
		PartSize:         512,
	}

	logctx.From(h.ctx).Info("Settings reset to defaults")

	SuccessWithMessage(c, settings, "Settings reset to defaults successfully")
}

// GetCurrentSettings 获取当前生效的设置（用于其他组件调用）
func (h *SettingsHandler) GetCurrentSettings() (*Settings, error) {
	// 打开设置存储命名空间
	settingsStorage, err := h.kvStore.Open("settings")
	if err != nil {
		return nil, err
	}

	// 获取设置数据
	data, err := settingsStorage.Get(context.Background(), "global")
	if err != nil && !kv.IsNotFound(err) {
		return nil, err
	}

	// 默认设置
	settings := &Settings{
		GlobalProxy:      "",
		ReconnectTimeout: 300,
		MaxThreads:       4,
		MaxTasks:         2,
		PartSize:         512,
	}

	// 如果存在保存的设置，解析JSON
	if data != nil {
		if err := json.Unmarshal(data, settings); err != nil {
			logctx.From(h.ctx).Warn("Failed to parse settings JSON, using defaults", zap.Error(err))
		}
	}

	return settings, nil
}