package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/iyear/tdl/pkg/kv"
	"github.com/iyear/tdl/web/backend/service"
	"github.com/iyear/tdl/web/backend/util"
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
	var req struct {
		Proxy string `json:"proxy"`
	}

	// 绑定JSON请求，但代理是可选的，所以即使失败也继续
	c.ShouldBindJSON(&req)

	// 使用客户端IP作为sessionID，保持一致性
	sessionID := h.getClientID(c)
	
	session, err := h.authService.StartQRLogin(sessionID, req.Proxy)
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
		Proxy string `json:"proxy"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 使用客户端IP作为sessionID，保持一致性
	sessionID := h.getClientID(c)

	session, err := h.authService.StartCodeLogin(sessionID, req.Phone, req.Proxy)
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

// getUserID 获取用户ID，优先使用Telegram ID，回退到安全的客户端IP
func (h *AuthHandler) getUserID(c *gin.Context) string {
	// 获取安全的客户端标识符
	clientID := h.getClientID(c)
	// 尝试获取Telegram ID
	telegramID, err := h.authService.GetAuthenticatedTelegramID(clientID)
	if err == nil {
		return fmt.Sprintf("%d", telegramID)
	}
	
	// 回退到使用安全的客户端IP
	return clientID
}

// getClientID 获取文件系统安全的客户端标识符
func (h *AuthHandler) getClientID(c *gin.Context) string {
	return util.SafeClientID(c.ClientIP())
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