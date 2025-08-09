package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/expr-lang/expr"
	"github.com/gin-gonic/gin"
	"github.com/gotd/td/telegram"
	"github.com/gotd/td/telegram/message/peer"
	"github.com/gotd/td/telegram/peers"
	"github.com/gotd/td/telegram/query"
	"github.com/gotd/td/tg"
	"go.uber.org/zap"

	"github.com/iyear/tdl/app/chat"
	"github.com/iyear/tdl/core/logctx"
	"github.com/iyear/tdl/core/storage"
	tclientcore "github.com/iyear/tdl/core/tclient"
	"github.com/iyear/tdl/core/util/tutil"
	"github.com/iyear/tdl/pkg/kv"
	"github.com/iyear/tdl/pkg/tclient"
	"github.com/iyear/tdl/pkg/texpr"
	"github.com/iyear/tdl/web/backend/service"
	"github.com/iyear/tdl/web/backend/util"
)

type ChatHandler struct {
	ctx         context.Context
	kvStore     kv.Storage
	authService *service.AuthService
}

func NewChatHandler(ctx context.Context, kvStore kv.Storage) *ChatHandler {
	return &ChatHandler{
		ctx:         ctx,
		kvStore:     kvStore,
		authService: service.NewAuthService(ctx, kvStore),
	}
}

// createTelegramClientForUser 为特定用户创建Telegram客户端
func (h *ChatHandler) createTelegramClientForUser(clientID string) (*telegram.Client, storage.Storage, error) {
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
func (h *ChatHandler) createTelegramClient(namespace string) (*telegram.Client, storage.Storage, error) {
	// 通过kv.Storage获取storage.Storage实例
	storageInstance, err := h.kvStore.Open(namespace)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to open storage namespace: %w", err)
	}

	// 获取当前设置
	settingsHandler := NewSettingsHandler(h.ctx, h.kvStore)
	settings, err := settingsHandler.GetCurrentSettings()
	if err != nil {
		logctx.From(h.ctx).Warn("Failed to load settings, using defaults", zap.Error(err))
		settings = &Settings{
			GlobalProxy:      "",
			ReconnectTimeout: 300,
		}
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
	logctx.From(h.ctx).Info("Creating Telegram client with settings",
		zap.String("proxy", o.Proxy),
		zap.Duration("reconnectTimeout", o.ReconnectTimeout))

	// 创建客户端，使用与CLI相同的参数
	client, err := tclient.New(h.ctx, o, false) // false表示不需要登录，使用已有session
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create telegram client: %w", err)
	}

	return client, storageInstance, nil
}

// ChatListRequest 聊天列表请求
type ChatListRequest struct {
	Output string `json:"output,omitempty"` // table 或 json
	Filter string `json:"filter,omitempty"` // 过滤表达式
	Page   int    `json:"page,omitempty"`   // 页码，从1开始
	Limit  int    `json:"limit,omitempty"`  // 每页条数，默认50
	Search string `json:"search,omitempty"` // 搜索关键词
}

// ChatExportRequest 消息导出请求
type ChatExportRequest struct {
	Type        string `json:"type" binding:"required"`        // time, id, last
	Chat        string `json:"chat,omitempty"`                 // 聊天ID或域名
	Thread      int    `json:"thread,omitempty"`               // 主题ID
	Input       []int  `json:"input" binding:"required"`       // 输入数据
	Filter      string `json:"filter,omitempty"`               // 过滤表达式
	OnlyMedia   bool   `json:"only_media,omitempty"`           // 仅媒体文件
	WithContent bool   `json:"with_content,omitempty"`         // 包含内容
	Raw         bool   `json:"raw,omitempty"`                  // 原始数据
	All         bool   `json:"all,omitempty"`                  // 所有消息
}

// ChatUsersRequest 用户导出请求
type ChatUsersRequest struct {
	Chat string `json:"chat" binding:"required"` // 聊天ID或域名
	Raw  bool   `json:"raw,omitempty"`           // 原始数据
}

// Dialog 聊天对话结构（模拟数据）
type Dialog struct {
	ID          int64   `json:"id"`
	Type        string  `json:"type"`
	VisibleName string  `json:"visible_name"`
	Username    string  `json:"username"`
	Topics      []Topic `json:"topics,omitempty"`
}

type Topic struct {
	ID    int    `json:"id"`
	Title string `json:"title"`
}

// GetChatList 获取聊天列表
func (h *ChatHandler) GetChatList(c *gin.Context) {
	var req ChatListRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 设置默认值
	if req.Output == "" {
		req.Output = "json"
	}
	if req.Filter == "" {
		req.Filter = "true"
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.Limit <= 0 {
		req.Limit = 50 // 默认50条每页，防止性能问题
	}
	if req.Limit > 200 {
		req.Limit = 200 // 最大200条，防止过大
	}

	// 使用安全的客户端IP获取用户命名空间
	clientID := util.SafeClientID(c.ClientIP())
	client, storageInstance, err := h.createTelegramClientForUser(clientID)
	if err != nil {
		logctx.From(h.ctx).Error("Failed to create telegram client", zap.Error(err))
		
		// 检查是否是认证相关错误
		errorMsg := err.Error()
		if strings.Contains(strings.ToLower(errorMsg), "not authenticated") ||
		   strings.Contains(strings.ToLower(errorMsg), "client not authenticated") ||
		   strings.Contains(strings.ToLower(errorMsg), "telegram user not authenticated") {
			c.JSON(http.StatusUnauthorized, map[string]interface{}{
				"success": false,
				"error":   "Not authorized. Please login to Telegram first",
				"code":    "UNAUTHORIZED",
			})
			return
		}
		
		InternalServerError(c, "Failed to connect to Telegram")
		return
	}

	// 收集对话数据
	var dialogs []*chat.Dialog

	// 使用 RunWithAuth 确保用户已认证
	err = tclientcore.RunWithAuth(h.ctx, client, func(ctx context.Context) error {
		// 解析输出类型
		var outputType chat.ListOutput
		switch req.Output {
		case "json":
			outputType = chat.ListOutputJson
		case "table":
			outputType = chat.ListOutputTable
		default:
			outputType = chat.ListOutputJson
		}

		// 创建选项
		opts := chat.ListOptions{
			Output: outputType,
			Filter: req.Filter,
		}

		// 收集结果而不是直接输出
		return h.collectDialogsList(ctx, client, storageInstance, opts, &dialogs)
	})

	if err != nil {
		logctx.From(h.ctx).Error("Failed to get chat list", zap.Error(err), zap.String("error_message", err.Error()))
		
		// 检查是否是认证相关错误 - 使用更宽泛的检查
		errorMsg := err.Error()
		if errorMsg == "not authorized. please login first" ||
		   strings.Contains(strings.ToLower(errorMsg), "not authorized") ||
		   strings.Contains(strings.ToLower(errorMsg), "unauthorized") ||
		   strings.Contains(strings.ToLower(errorMsg), "not logged in") ||
		   strings.Contains(strings.ToLower(errorMsg), "login") ||
		   strings.Contains(strings.ToLower(errorMsg), "auth") {
			logctx.From(h.ctx).Info("Authentication required for chat list", zap.String("error", errorMsg))
			c.JSON(http.StatusUnauthorized, map[string]interface{}{
				"success": false,
				"error":   "Not authorized. Please login to Telegram first",
				"code":    "UNAUTHORIZED",
			})
			return
		}
		
		InternalServerError(c, "Failed to retrieve chat list")
		return
	}

	// 应用搜索过滤
	filteredDialogs := h.applySearchFilter(dialogs, req.Search)
	
	// 计算分页
	totalCount := len(filteredDialogs)
	totalPages := (totalCount + req.Limit - 1) / req.Limit
	
	// 应用分页
	start := (req.Page - 1) * req.Limit
	end := start + req.Limit
	if start >= totalCount {
		filteredDialogs = []*chat.Dialog{}
	} else {
		if end > totalCount {
			end = totalCount
		}
		filteredDialogs = filteredDialogs[start:end]
	}

	Success(c, map[string]interface{}{
		"message":     "Chat list retrieved successfully",
		"data":        filteredDialogs,
		"count":       len(filteredDialogs),
		"total_count": totalCount,
		"page":        req.Page,
		"limit":       req.Limit,
		"total_pages": totalPages,
		"has_next":    req.Page < totalPages,
		"has_prev":    req.Page > 1,
	})
}

// collectDialogsList 收集对话列表数据，基于app/chat.List的实现但返回数据而不是输出
func (h *ChatHandler) collectDialogsList(ctx context.Context, c *telegram.Client, storageInstance storage.Storage, opts chat.ListOptions, result *[]*chat.Dialog) error {
	// 创建临时的结果收集器，而不是直接输出
	dialogs, err := h.getDialogsData(ctx, c, storageInstance, opts)
	if err != nil {
		return err
	}

	*result = dialogs
	return nil
}

// getDialogsData 获取对话数据，基于 app/chat/ls.go 的核心实现
func (h *ChatHandler) getDialogsData(ctx context.Context, c *telegram.Client, storageInstance storage.Storage, opts chat.ListOptions) ([]*chat.Dialog, error) {
	log := logctx.From(ctx)

	// compile filter
	filter, err := expr.Compile(opts.Filter, expr.AsBool())
	if err != nil {
		return nil, fmt.Errorf("failed to compile filter: %w", err)
	}

	dialogs, err := query.GetDialogs(c.API()).BatchSize(100).Collect(ctx)
	if err != nil {
		return nil, err
	}

	blocked, err := tutil.GetBlockedDialogs(ctx, c.API())
	if err != nil {
		return nil, err
	}

	manager := peers.Options{Storage: storage.NewPeers(storageInstance)}.Build(c.API())
	result := make([]*chat.Dialog, 0, len(dialogs))
	
	for _, d := range dialogs {
		id := tutil.GetInputPeerID(d.Peer)

		// we can update our access hash state if there is any new peer.
		if err = h.applyPeers(ctx, manager, d.Entities, id); err != nil {
			log.Warn("failed to apply peer updates", zap.Int64("id", id), zap.Error(err))
		}

		// filter blocked peers
		if _, ok := blocked[id]; ok {
			continue
		}

		var r *chat.Dialog
		switch t := d.Peer.(type) {
		case *tg.InputPeerUser:
			r = h.processUser(t.UserID, d.Entities)
		case *tg.InputPeerChannel:
			r = h.processChannel(ctx, c.API(), t.ChannelID, d.Entities)
		case *tg.InputPeerChat:
			r = h.processChat(t.ChatID, d.Entities)
		}

		// skip unsupported types
		if r == nil {
			continue
		}

		// filter
		b, err := texpr.Run(filter, r)
		if err != nil {
			return nil, fmt.Errorf("failed to run filter: %w", err)
		}
		if !b.(bool) {
			continue
		}

		result = append(result, r)
	}

	return result, nil
}

// 辅助方法，基于 app/chat/ls.go 的实现
func (h *ChatHandler) processUser(id int64, entities peer.Entities) *chat.Dialog {
	u, ok := entities.User(id)
	if !ok {
		return nil
	}

	return &chat.Dialog{
		ID:          u.ID,
		VisibleName: h.visibleName(u.FirstName, u.LastName),
		Username:    u.Username,
		Type:        "private",
		Topics:      nil,
	}
}

func (h *ChatHandler) processChannel(ctx context.Context, api *tg.Client, id int64, entities peer.Entities) *chat.Dialog {
	c, ok := entities.Channel(id)
	if !ok {
		return nil
	}

	d := &chat.Dialog{
		ID:          c.ID,
		VisibleName: c.Title,
		Username:    c.Username,
	}

	// channel type
	switch {
	case c.Broadcast:
		d.Type = "channel"
	case c.Megagroup, c.Gigagroup:
		d.Type = "group"
	default:
		d.Type = "unknown"
	}

	if c.Forum {
		topics, err := h.fetchTopics(ctx, api, c.AsInput())
		if err != nil {
			logctx.From(ctx).Error("failed to fetch topics",
				zap.Int64("channel_id", c.ID),
				zap.String("channel_username", c.Username),
				zap.Error(err))
			return nil
		}
		d.Topics = topics
	}

	return d
}

func (h *ChatHandler) processChat(id int64, entities peer.Entities) *chat.Dialog {
	c, ok := entities.Chat(id)
	if !ok {
		return nil
	}

	return &chat.Dialog{
		ID:          c.ID,
		VisibleName: c.Title,
		Username:    "-",
		Type:        "group",
		Topics:      nil,
	}
}

func (h *ChatHandler) visibleName(first, last string) string {
	if first == "" && last == "" {
		return ""
	}

	if first == "" {
		return last
	}

	if last == "" {
		return first
	}

	return first + " " + last
}

func (h *ChatHandler) fetchTopics(ctx context.Context, api *tg.Client, c tg.InputChannelClass) ([]chat.Topic, error) {
	res := make([]chat.Topic, 0)
	limit := 100
	offsetTopic, offsetID, offsetDate := 0, 0, 0

	for {
		req := &tg.ChannelsGetForumTopicsRequest{
			Channel:     c,
			Limit:       limit,
			OffsetTopic: offsetTopic,
			OffsetID:    offsetID,
			OffsetDate:  offsetDate,
		}

		topics, err := api.ChannelsGetForumTopics(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("get forum topics: %w", err)
		}

		for _, tp := range topics.Topics {
			if t, ok := tp.(*tg.ForumTopic); ok {
				res = append(res, chat.Topic{
					ID:    t.ID,
					Title: t.Title,
				})
				offsetTopic = t.ID
			}
		}

		// last page
		if len(topics.Topics) < limit {
			break
		}

		if lastMsg, ok := topics.Messages[len(topics.Messages)-1].AsNotEmpty(); ok {
			offsetID, offsetDate = lastMsg.GetID(), lastMsg.GetDate()
		}
	}

	return res, nil
}

func (h *ChatHandler) applyPeers(ctx context.Context, manager *peers.Manager, entities peer.Entities, id int64) error {
	users := make([]tg.UserClass, 0, 1)
	if user, ok := entities.User(id); ok {
		users = append(users, user)
	}

	chats := make([]tg.ChatClass, 0, 1)
	if chat, ok := entities.Chat(id); ok {
		chats = append(chats, chat)
	}
	if channel, ok := entities.Channel(id); ok {
		chats = append(chats, channel)
	}

	return manager.Apply(ctx, users, chats)
}


// ExportChatMessages 导出聊天消息
func (h *ChatHandler) ExportChatMessages(c *gin.Context) {
	var req ChatExportRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 验证导出类型
	switch req.Type {
	case "time", "id", "last":
		// 合法类型
	default:
		ValidationError(c, "type must be 'time', 'id' or 'last'")
		return
	}

	// 验证输入参数
	switch req.Type {
	case "time", "id":
		if len(req.Input) != 2 {
			ValidationError(c, "input must contain 2 integers for time/id type")
			return
		}
	case "last":
		if len(req.Input) != 1 {
			ValidationError(c, "input must contain 1 integer for last type")
			return
		}
	}

	// 使用安全的客户端IP获取用户命名空间
	clientID := util.SafeClientID(c.ClientIP())
	client, storageInstance, err := h.createTelegramClientForUser(clientID)
	if err != nil {
		logctx.From(h.ctx).Error("Failed to create telegram client", zap.Error(err))
		
		// 检查是否是认证相关错误
		errorMsg := err.Error()
		if strings.Contains(strings.ToLower(errorMsg), "not authenticated") ||
		   strings.Contains(strings.ToLower(errorMsg), "client not authenticated") ||
		   strings.Contains(strings.ToLower(errorMsg), "telegram user not authenticated") {
			c.JSON(http.StatusUnauthorized, map[string]interface{}{
				"success": false,
				"error":   "Not authorized. Please login to Telegram first",
				"code":    "UNAUTHORIZED",
			})
			return
		}
		
		InternalServerError(c, "Failed to connect to Telegram")
		return
	}

	// 生成输出文件名
	outputFile := filepath.Join(os.TempDir(), fmt.Sprintf("tdl-export-%d.json", time.Now().Unix()))

	// 设置默认值
	if req.Filter == "" {
		req.Filter = "true"
	}

	// 转换导出类型
	var exportType chat.ExportType
	switch req.Type {
	case "time":
		exportType = chat.ExportTypeTime
	case "id":
		exportType = chat.ExportTypeId  
	case "last":
		exportType = chat.ExportTypeLast
	}

	// 构建导出选项
	exportOpts := chat.ExportOptions{
		Type:        exportType,
		Chat:        req.Chat,
		Thread:      req.Thread,
		Input:       req.Input,
		Output:      outputFile,
		Filter:      req.Filter,
		OnlyMedia:   req.OnlyMedia,
		WithContent: req.WithContent,
		Raw:         req.Raw,
		All:         req.All,
	}

	// 异步执行导出任务
	taskID := fmt.Sprintf("export_%d", time.Now().Unix())
	go func() {
		err := tclientcore.RunWithAuth(h.ctx, client, func(ctx context.Context) error {
			return chat.Export(ctx, client, storageInstance, exportOpts)
		})
		if err != nil {
			logctx.From(h.ctx).Error("Export task failed", 
				zap.String("task_id", taskID), 
				zap.Error(err))
			// TODO: 通过WebSocket通知前端任务失败
		} else {
			logctx.From(h.ctx).Info("Export task completed", 
				zap.String("task_id", taskID),
				zap.String("output_file", outputFile))
			// TODO: 通过WebSocket通知前端任务完成
		}
	}()

	Success(c, map[string]interface{}{
		"message":     "Export job submitted successfully",
		"task_id":     taskID,
		"output_file": outputFile,
		"type":        req.Type,
		"chat":        req.Chat,
		"status":      "pending",
	})
}

// ExportChatUsers 导出聊天用户
func (h *ChatHandler) ExportChatUsers(c *gin.Context) {
	var req ChatUsersRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		ValidationError(c, err.Error())
		return
	}

	// 使用安全的客户端IP获取用户命名空间
	clientID := util.SafeClientID(c.ClientIP())
	client, storageInstance, err := h.createTelegramClientForUser(clientID)
	if err != nil {
		logctx.From(h.ctx).Error("Failed to create telegram client", zap.Error(err))
		
		// 检查是否是认证相关错误
		errorMsg := err.Error()
		if strings.Contains(strings.ToLower(errorMsg), "not authenticated") ||
		   strings.Contains(strings.ToLower(errorMsg), "client not authenticated") ||
		   strings.Contains(strings.ToLower(errorMsg), "telegram user not authenticated") {
			c.JSON(http.StatusUnauthorized, map[string]interface{}{
				"success": false,
				"error":   "Not authorized. Please login to Telegram first",
				"code":    "UNAUTHORIZED",
			})
			return
		}
		
		InternalServerError(c, "Failed to connect to Telegram")
		return
	}

	// 生成输出文件名
	outputFile := filepath.Join(os.TempDir(), fmt.Sprintf("tdl-users-%d.json", time.Now().Unix()))

	// 构建用户导出选项
	usersOpts := chat.UsersOptions{
		Chat:   req.Chat,
		Output: outputFile,
		Raw:    req.Raw,
	}

	// 异步执行导出任务
	taskID := fmt.Sprintf("users_%d", time.Now().Unix())
	go func() {
		err := tclientcore.RunWithAuth(h.ctx, client, func(ctx context.Context) error {
			return chat.Users(ctx, client, storageInstance, usersOpts)
		})
		if err != nil {
			logctx.From(h.ctx).Error("Users export task failed", 
				zap.String("task_id", taskID), 
				zap.Error(err))
			// TODO: 通过WebSocket通知前端任务失败
		} else {
			logctx.From(h.ctx).Info("Users export task completed", 
				zap.String("task_id", taskID),
				zap.String("output_file", outputFile))
			// TODO: 通过WebSocket通知前端任务完成
		}
	}()

	Success(c, map[string]interface{}{
		"message":     "Users export job submitted successfully",
		"task_id":     taskID,
		"output_file": outputFile,
		"chat":        req.Chat,
		"status":      "pending",
	})
}

// applySearchFilter 应用搜索过滤
func (h *ChatHandler) applySearchFilter(dialogs []*chat.Dialog, search string) []*chat.Dialog {
	if search == "" {
		return dialogs
	}
	
	search = strings.ToLower(strings.TrimSpace(search))
	filtered := make([]*chat.Dialog, 0)
	
	for _, dialog := range dialogs {
		// 搜索名称、用户名、类型
		if strings.Contains(strings.ToLower(dialog.VisibleName), search) ||
		   strings.Contains(strings.ToLower(dialog.Username), search) ||
		   strings.Contains(strings.ToLower(dialog.Type), search) ||
		   strings.Contains(fmt.Sprintf("%d", dialog.ID), search) {
			filtered = append(filtered, dialog)
			continue
		}
		
		// 搜索主题标题
		if dialog.Topics != nil {
			for _, topic := range dialog.Topics {
				if strings.Contains(strings.ToLower(topic.Title), search) {
					filtered = append(filtered, dialog)
					break
				}
			}
		}
	}
	
	return filtered
}