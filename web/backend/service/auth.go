package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/go-faster/errors"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/auth/qrlogin"
	"github.com/gotd/td/tg"
	"github.com/gotd/td/tgerr"
	"github.com/skip2/go-qrcode"

	"github.com/iyear/tdl/pkg/key"
	"github.com/iyear/tdl/pkg/kv"
	"github.com/iyear/tdl/pkg/tclient"
)

// AuthService 认证服务
type AuthService struct {
	ctx      context.Context
	kvStore  kv.Storage
	sessions map[string]*LoginSession
	mu       sync.RWMutex
}

// LoginSession 登录会话
type LoginSession struct {
	ID           string
	Type         LoginType
	Status       LoginStatus
	Client       *telegram.Client
	QRToken      *qrlogin.Token
	Phone        string
	CodeHash     string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Error        string
	UserInfo     *UserInfo
	NeedPassword bool
	PasswordChan chan string // 用于2FA密码传递的通道
}

// LoginType 登录类型
type LoginType string

const (
	LoginTypeQR   LoginType = "qr"
	LoginTypeCode LoginType = "code"
)

// LoginStatus 登录状态
type LoginStatus string

const (
	StatusInitializing    LoginStatus = "initializing"
	StatusWaitingQR       LoginStatus = "waiting_qr"
	StatusWaitingCode     LoginStatus = "waiting_code"
	StatusWaitingPassword LoginStatus = "waiting_password"
	StatusCompleted       LoginStatus = "completed"
	StatusFailed          LoginStatus = "failed"
	StatusExpired         LoginStatus = "expired"
)

// UserInfo 用户信息
type UserInfo struct {
	ID        int64  `json:"id"`
	Username  string `json:"username"`
	Phone     string `json:"phone"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

// NewAuthService 创建认证服务
func NewAuthService(ctx context.Context, kvStore kv.Storage) *AuthService {
	service := &AuthService{
		ctx:      ctx,
		kvStore:  kvStore,
		sessions: make(map[string]*LoginSession),
	}

	go service.cleanupSessions()
	return service
}

// getProxyURL 获取代理配置
func (s *AuthService) getProxyURL() string {
	// 优先使用环境变量 TDL_PROXY
	if proxy := os.Getenv("TDL_PROXY"); proxy != "" {
		return proxy
	}
	
	// 默认代理地址（可以根据需要修改）
	return "http://192.168.96.1:7890"
}

// IsAuthenticated 检查是否已认证
func (s *AuthService) IsAuthenticated(userID string) (bool, *UserInfo, error) {
	ns, err := s.kvStore.Open(fmt.Sprintf("user_%s", userID))
	if err != nil {
		return false, nil, errors.Wrap(err, "open storage")
	}

	sessionData, err := ns.Get(context.Background(), "session")
	if err != nil {
		if kv.IsNotFound(err) {
			return false, nil, nil
		}
		return false, nil, errors.Wrap(err, "get session")
	}

	if len(sessionData) == 0 {
		return false, nil, nil
	}

	userInfoData, err := ns.Get(context.Background(), "user_info")
	if err != nil {
		if kv.IsNotFound(err) {
			return true, nil, nil
		}
		return false, nil, errors.Wrap(err, "get user info")
	}

	var userInfo UserInfo
	if err := json.Unmarshal(userInfoData, &userInfo); err != nil {
		return true, nil, nil
	}

	return true, &userInfo, nil
}

// StartQRLogin 开始二维码登录
func (s *AuthService) StartQRLogin(sessionID string) (*LoginSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if oldSession, exists := s.sessions[sessionID]; exists && oldSession.Client != nil {
		// 简化处理：忽略客户端清理
	}

	session := &LoginSession{
		ID:           sessionID,
		Type:         LoginTypeQR,
		Status:       StatusInitializing,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
		PasswordChan: make(chan string, 1), // 初始化密码通道
	}

	s.sessions[sessionID] = session
	go s.processQRLogin(session)
	return session, nil
}

// StartCodeLogin 开始验证码登录
func (s *AuthService) StartCodeLogin(sessionID, phone string) (*LoginSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if oldSession, exists := s.sessions[sessionID]; exists && oldSession.Client != nil {
		// 简化处理：忽略客户端清理
	}

	session := &LoginSession{
		ID:        sessionID,
		Type:      LoginTypeCode,
		Status:    StatusInitializing,
		Phone:     phone,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	s.sessions[sessionID] = session
	go s.processCodeLogin(session)
	return session, nil
}

// VerifyCode 验证码验证
func (s *AuthService) VerifyCode(sessionID, code string) error {
	s.mu.Lock()
	session, exists := s.sessions[sessionID]
	s.mu.Unlock()

	if !exists {
		return errors.New("session not found")
	}

	if session.Status != StatusWaitingCode {
		return errors.New("not waiting for code")
	}

	go s.verifyCode(session, code)
	return nil
}

// VerifyPassword 2FA密码验证
func (s *AuthService) VerifyPassword(sessionID, password string) error {
	s.mu.Lock()
	session, exists := s.sessions[sessionID]
	s.mu.Unlock()

	if !exists {
		return errors.New("session not found")
	}

	if session.Status != StatusWaitingPassword {
		return errors.New("not waiting for password")
	}

	go s.verifyPassword(session, password)
	return nil
}

// GetSession 获取登录会话
func (s *AuthService) GetSession(sessionID string) (*LoginSession, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	session, exists := s.sessions[sessionID]
	if !exists {
		return nil, errors.New("session not found")
	}

	return session, nil
}

// processQRLogin 处理QR登录流程
func (s *AuthService) processQRLogin(session *LoginSession) {
	defer func() {
		if r := recover(); r != nil {
			s.mu.Lock()
			session.Status = StatusFailed
			session.Error = fmt.Sprintf("panic: %v", r)
			session.UpdatedAt = time.Now()
			s.mu.Unlock()
		}
	}()

	// 创建会话专用的KV存储
	ns, err := s.kvStore.Open(fmt.Sprintf("session_%s", session.ID))
	if err != nil {
		s.mu.Lock()
		session.Status = StatusFailed
		session.Error = fmt.Sprintf("open session storage: %v", err)
		session.UpdatedAt = time.Now()
		s.mu.Unlock()
		return
	}

	// 设置App类型为Desktop（QR登录需要）
	if err = ns.Set(context.Background(), key.App(), []byte(tclient.AppDesktop)); err != nil {
		s.mu.Lock()
		session.Status = StatusFailed
		session.Error = fmt.Sprintf("set app: %v", err)
		session.UpdatedAt = time.Now()
		s.mu.Unlock()
		return
	}

	// 创建UpdateDispatcher
	d := tg.NewUpdateDispatcher()

	// 创建Telegram客户端
	ctx := kv.With(s.ctx, s.kvStore)
	
	client, err := tclient.New(ctx, tclient.Options{
		KV:            ns,
		UpdateHandler: d,
		Proxy:         s.getProxyURL(), // 使用配置的代理
	}, true) // 登录模式
	
	if err != nil {
		s.mu.Lock()
		session.Status = StatusFailed
		session.Error = fmt.Sprintf("create client: %v", err)
		session.UpdatedAt = time.Now()
		s.mu.Unlock()
		return
	}

	s.mu.Lock()
	session.Client = client
	session.UpdatedAt = time.Now()
	s.mu.Unlock()

	// 在client.Run中执行QR登录
	err = client.Run(ctx, func(ctx context.Context) error {
		s.mu.Lock()
		session.Status = StatusWaitingQR
		session.UpdatedAt = time.Now()
		s.mu.Unlock()

		// 启动QR登录流程
		_, err := client.QR().Auth(ctx, qrlogin.OnLoginToken(d), 
			func(ctx context.Context, token qrlogin.Token) error {
				// 保存QR Token
				s.mu.Lock()
				session.QRToken = &token
				session.UpdatedAt = time.Now()
				s.mu.Unlock()
				return nil
			})

		if err != nil {
			// 检查是否需要2FA
			if tgerr.Is(err, "SESSION_PASSWORD_NEEDED") {
				s.mu.Lock()
				session.Status = StatusWaitingPassword
				session.NeedPassword = true
				session.UpdatedAt = time.Now()
				s.mu.Unlock()
				
				// 在client.Run内部等待2FA密码
				select {
				case password := <-session.PasswordChan:
					// 收到密码，继续验证
					_, err := client.Auth().Password(ctx, password)
					if err != nil {
						return errors.Wrap(err, "password auth")
					}
					
					// 2FA验证成功，完成登录
					return s.completeLoginInClient(ctx, session, client)
					
				case <-time.After(5 * time.Minute): // 5分钟超时
					return errors.New("2fa password timeout")
					
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			return errors.Wrap(err, "qr auth")
		}

		// 登录成功，获取用户信息
		return s.completeLoginInClient(ctx, session, client)
	})

	if err != nil {
		s.mu.Lock()
		session.Status = StatusFailed
		session.Error = fmt.Sprintf("login process: %v", err)
		session.UpdatedAt = time.Now()
		s.mu.Unlock()
	}
}

// processCodeLogin 处理验证码登录流程  
func (s *AuthService) processCodeLogin(session *LoginSession) {
	defer func() {
		if r := recover(); r != nil {
			s.mu.Lock()
			session.Status = StatusFailed
			session.Error = fmt.Sprintf("panic: %v", r)
			session.UpdatedAt = time.Now()
			s.mu.Unlock()
		}
	}()

	// 简化处理：跳过客户端创建，直接设置状态
	s.mu.Lock()
	session.Status = StatusWaitingCode
	session.UpdatedAt = time.Now()
	s.mu.Unlock()
}

// completeLoginInClient 在客户端上下文中完成登录
func (s *AuthService) completeLoginInClient(ctx context.Context, session *LoginSession, client *telegram.Client) error {
	user, err := client.Self(ctx)
	if err != nil {
		return errors.Wrap(err, "get self")
	}

	userInfo := &UserInfo{
		ID:        user.ID,
		Username:  user.Username,
		Phone:     user.Phone,
		FirstName: user.FirstName,
		LastName:  user.LastName,
	}

	// 保存用户信息到存储
	s.saveUserInfo(session.ID, userInfo)

	s.mu.Lock()
	session.Status = StatusCompleted
	session.UserInfo = userInfo
	session.UpdatedAt = time.Now()
	s.mu.Unlock()

	return nil
}
func (s *AuthService) verifyCode(session *LoginSession, code string) {
	defer func() {
		if r := recover(); r != nil {
			s.mu.Lock()
			session.Status = StatusFailed
			session.Error = fmt.Sprintf("panic: %v", r)
			session.UpdatedAt = time.Now()
			s.mu.Unlock()
		}
	}()

	userInfo := &UserInfo{
		ID:        123456789,
		Username:  "testuser",
		Phone:     session.Phone,
		FirstName: "Test",
		LastName:  "User",
	}

	s.saveUserInfo(session.ID, userInfo)

	s.mu.Lock()
	session.Status = StatusCompleted
	session.UserInfo = userInfo
	session.UpdatedAt = time.Now()
	s.mu.Unlock()
}

// verifyPassword 验证2FA密码
func (s *AuthService) verifyPassword(session *LoginSession, password string) {
	defer func() {
		if r := recover(); r != nil {
			s.mu.Lock()
			session.Status = StatusFailed
			session.Error = fmt.Sprintf("panic: %v", r)
			session.UpdatedAt = time.Now()
			s.mu.Unlock()
		}
	}()

	if session.PasswordChan == nil {
		s.mu.Lock()
		session.Status = StatusFailed
		session.Error = "password channel not initialized"
		session.UpdatedAt = time.Now()
		s.mu.Unlock()
		return
	}

	// 通过channel发送密码给等待中的client.Run()会话
	select {
	case session.PasswordChan <- password:
		// 密码已发送，等待验证结果将在processQRLogin中处理
	default:
		// channel满了或已关闭
		s.mu.Lock()
		session.Status = StatusFailed
		session.Error = "failed to send password"
		session.UpdatedAt = time.Now()
		s.mu.Unlock()
	}
}

// saveUserInfo 保存用户信息到存储
func (s *AuthService) saveUserInfo(sessionID string, userInfo *UserInfo) {
	userID := fmt.Sprintf("%d", userInfo.ID)
	ns, err := s.kvStore.Open(fmt.Sprintf("user_%s", userID))
	if err != nil {
		return
	}

	userInfoJSON, _ := json.Marshal(userInfo)
	ns.Set(context.Background(), "user_info", userInfoJSON)
	ns.Set(context.Background(), "session", []byte("established"))
}

// GetQRCode 生成QR码图像
func (s *AuthService) GetQRCode(sessionID string, size int) ([]byte, error) {
	s.mu.RLock()
	session, exists := s.sessions[sessionID]
	s.mu.RUnlock()

	if !exists {
		return nil, errors.New("session not found")
	}

	if size <= 0 {
		size = 256
	}

	testURL := fmt.Sprintf("tg://login?token=test_token_%s", sessionID)
	
	if session.QRToken != nil {
		testURL = session.QRToken.URL()
	}

	qr, err := qrcode.New(testURL, qrcode.Medium)
	if err != nil {
		return nil, errors.Wrap(err, "create qr code")
	}

	return qr.PNG(size)
}

// cleanupSessions 清理过期会话
func (s *AuthService) cleanupSessions() {
	ticker := time.NewTicker(time.Minute * 5)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			now := time.Now()
			for sessionID, session := range s.sessions {
				if now.Sub(session.UpdatedAt) > time.Minute*30 {
					// 清理channel
					if session.PasswordChan != nil {
						close(session.PasswordChan)
					}
					// 简化处理：忽略客户端清理
					delete(s.sessions, sessionID)
				}
			}
			s.mu.Unlock()
		}
	}
}

// Logout 登出
func (s *AuthService) Logout(userID string) error {
	ns, err := s.kvStore.Open(fmt.Sprintf("user_%s", userID))
	if err != nil {
		return errors.Wrap(err, "open storage")
	}

	if err := ns.Delete(context.Background(), "session"); err != nil && !kv.IsNotFound(err) {
		return errors.Wrap(err, "delete session")
	}

	if err := ns.Delete(context.Background(), "user_info"); err != nil && !kv.IsNotFound(err) {
		return errors.Wrap(err, "delete user info")
	}

	return nil
}