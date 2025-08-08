package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/iyear/tdl/pkg/kv"
	"github.com/iyear/tdl/web/backend/service"
	"github.com/iyear/tdl/web/backend/websocket"
)

type AuthHandler struct {
	ctx         context.Context
	kvStore     kv.Storage
	authService *service.AuthService
	wsHub       *websocket.Hub
}

func NewAuthHandler(ctx context.Context, kvStore kv.Storage, wsHub *websocket.Hub) *AuthHandler {
	return &AuthHandler{
		ctx:         ctx,
		kvStore:     kvStore,
		authService: service.NewAuthService(ctx, kvStore),
		wsHub:       wsHub,
	}
}

// GetStatus 获取认证状态
func (h *AuthHandler) GetStatus(c *gin.Context) {
	userID := h.getUserID(c)
	
	authenticated, userInfo, err := h.authService.IsAuthenticated(userID)
	if err != nil {
		Error(c, http.StatusInternalServerError, fmt.Errorf("check authentication: %v", err))
		return
	}

	Success(c, map[string]interface{}{
		"authenticated": authenticated,
		"user":          userInfo,
	})
}

// StartQRLogin 开始二维码登录
func (h *AuthHandler) StartQRLogin(c *gin.Context) {
	sessionID := uuid.New().String()
	
	session, err := h.authService.StartQRLogin(sessionID)
	if err != nil {
		Error(c, http.StatusInternalServerError, fmt.Errorf("start qr login: %v", err))
		return
	}

	// 启动会话状态监控
	go h.monitorSessionStatus(session)

	Success(c, map[string]interface{}{
		"session_id": sessionID,
		"status":     session.Status,
	})
}

// GetQRCode 获取二维码图片
func (h *AuthHandler) GetQRCode(c *gin.Context) {
	sessionID := c.Param("sessionId")
	if sessionID == "" {
		ValidationError(c, "session_id is required")
		return
	}

	sizeStr := c.DefaultQuery("size", "256")
	size, _ := strconv.Atoi(sizeStr)

	qrData, err := h.authService.GetQRCode(sessionID, size)
	if err != nil {
		Error(c, http.StatusInternalServerError, fmt.Errorf("get qr code: %v", err))
		return
	}

	c.Header("Content-Type", "image/png")
	c.Header("Content-Length", fmt.Sprintf("%d", len(qrData)))
	c.Data(http.StatusOK, "image/png", qrData)
}

// CheckQRStatus 检查二维码登录状态
func (h *AuthHandler) CheckQRStatus(c *gin.Context) {
	sessionID := c.Param("sessionId")
	if sessionID == "" {
		ValidationError(c, "session_id is required")
		return
	}

	session, err := h.authService.GetSession(sessionID)
	if err != nil {
		Error(c, http.StatusNotFound, errors.New("session not found"))
		return
	}

	result := map[string]interface{}{
		"status":      session.Status,
		"updated_at":  session.UpdatedAt,
		"need_password": session.NeedPassword,
	}

	if session.Error != "" {
		result["error"] = session.Error
	}

	if session.UserInfo != nil {
		result["user"] = session.UserInfo
	}

	Success(c, result)
}

// StartCodeLogin 开始验证码登录
func (h *AuthHandler) StartCodeLogin(c *gin.Context) {
	var req struct {
		Phone string `json:"phone" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	sessionID := uuid.New().String()

	session, err := h.authService.StartCodeLogin(sessionID, req.Phone)
	if err != nil {
		Error(c, http.StatusInternalServerError, fmt.Errorf("start code login: %v", err))
		return
	}

	// 启动会话状态监控
	go h.monitorSessionStatus(session)

	Success(c, map[string]interface{}{
		"session_id": sessionID,
		"status":     session.Status,
		"phone":      req.Phone,
	})
}

// VerifyCode 验证登录码
func (h *AuthHandler) VerifyCode(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id" binding:"required"`
		Code      string `json:"code" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	err := h.authService.VerifyCode(req.SessionID, req.Code)
	if err != nil {
		Error(c, http.StatusInternalServerError, fmt.Errorf("verify code: %v", err))
		return
	}

	SuccessWithMessage(c, nil, "Code verification started")
}

// VerifyPassword 验证2FA密码
func (h *AuthHandler) VerifyPassword(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id" binding:"required"`
		Password  string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	err := h.authService.VerifyPassword(req.SessionID, req.Password)
	if err != nil {
		Error(c, http.StatusInternalServerError, fmt.Errorf("verify password: %v", err))
		return
	}

	SuccessWithMessage(c, nil, "Password verification started")
}

// Logout 退出登录
func (h *AuthHandler) Logout(c *gin.Context) {
	userID := h.getUserID(c)
	
	err := h.authService.Logout(userID)
	if err != nil {
		Error(c, http.StatusInternalServerError, fmt.Errorf("logout: %v", err))
		return
	}

	SuccessWithMessage(c, nil, "Logged out successfully")
}

// getUserID 获取用户ID，这里简化为使用IP地址作为用户标识
// 实际应用中应该使用更安全的用户标识方案
func (h *AuthHandler) getUserID(c *gin.Context) string {
	// 简化实现：使用客户端IP作为用户ID
	// 实际应用中应该使用JWT token或其他认证机制
	return c.ClientIP()
}

// monitorSessionStatus 监控会话状态变化并推送WebSocket消息
func (h *AuthHandler) monitorSessionStatus(session *service.LoginSession) {
	ticker := time.NewTicker(time.Second * 2)
	defer ticker.Stop()

	lastStatus := session.Status
	for {
		select {
		case <-h.ctx.Done():
			return
		case <-ticker.C:
			currentSession, err := h.authService.GetSession(session.ID)
			if err != nil {
				return // 会话不存在，停止监控
			}

			// 状态发生变化时推送WebSocket消息
			if currentSession.Status != lastStatus {
				// 发送WebSocket更新
				h.wsHub.BroadcastNotification(fmt.Sprintf("Login status: %s", currentSession.Status), "info")
				lastStatus = currentSession.Status
			}

			// 终态时停止监控
			if currentSession.Status == service.StatusCompleted ||
				currentSession.Status == service.StatusFailed ||
				currentSession.Status == service.StatusExpired {
				return
			}
		}
	}
}