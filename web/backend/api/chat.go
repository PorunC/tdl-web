package api

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
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
	"github.com/iyear/tdl/core/util/tutil"
	"github.com/iyear/tdl/pkg/kv"
	"github.com/iyear/tdl/pkg/tclient"
	"github.com/iyear/tdl/pkg/texpr"
)

type ChatHandler struct {
	ctx     context.Context
	kvStore kv.Storage
}

func NewChatHandler(ctx context.Context, kvStore kv.Storage) *ChatHandler {
	return &ChatHandler{
		ctx:     ctx,
		kvStore: kvStore,
	}
}

// createTelegramClient 创建Telegram客户端
func (h *ChatHandler) createTelegramClient() (*telegram.Client, error) {
	// 使用tclient包创建客户端
	client, err := tclient.New(h.ctx, tclient.Options{
		KV:               h.kvStore,
		ReconnectTimeout: 10 * time.Second,
	}, false) // false表示不需要登录，使用已有session
	if err != nil {
		return nil, fmt.Errorf("failed to create telegram client: %w", err)
	}

	return client, nil
}

// ChatListRequest 聊天列表请求
type ChatListRequest struct {
	Output string `json:"output,omitempty"` // table 或 json
	Filter string `json:"filter,omitempty"` // 过滤表达式
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

	// 创建Telegram客户端
	client, err := h.createTelegramClient()
	if err != nil {
		logctx.From(h.ctx).Error("Failed to create telegram client", zap.Error(err))
		InternalServerError(c, "Failed to connect to Telegram")
		return
	}

	// 创建临时存储实例用于chat.List
	kvd := h.kvStore

	// 调用chat.List获取真实数据
	var dialogs []*chat.Dialog
	listOpts := chat.ListOptions{
		Output: chat.ListOutputJson, // 强制使用JSON格式
		Filter: req.Filter,
	}

	// 我们需要自己实现获取dialogs的逻辑，因为chat.List是输出到控制台的
	// 让我们直接调用chat包的内部逻辑
	err = client.Run(h.ctx, func(ctx context.Context) error {
		// 创建一个自定义的list函数来获取数据而不是直接输出
		return h.getDialogsList(ctx, client, kvd, req.Filter, &dialogs)
	})

	if err != nil {
		logctx.From(h.ctx).Error("Failed to get chat list", zap.Error(err))
		InternalServerError(c, "Failed to retrieve chat list")
		return
	}

	Success(c, map[string]interface{}{
		"message": "Chat list retrieved successfully",
		"data":    dialogs,
		"count":   len(dialogs),
	})
}

// getDialogsList 获取对话列表，基于chat.List的核心逻辑
func (h *ChatHandler) getDialogsList(ctx context.Context, c *telegram.Client, kvd kv.Storage, filterExpr string, result *[]*chat.Dialog) error {
	log := logctx.From(ctx)

	// compile filter
	filter, err := expr.Compile(filterExpr, expr.AsBool())
	if err != nil {
		return fmt.Errorf("failed to compile filter: %w", err)
	}

	dialogs, err := query.GetDialogs(c.API()).BatchSize(100).Collect(ctx)
	if err != nil {
		return err
	}

	blocked, err := tutil.GetBlockedDialogs(ctx, c.API())
	if err != nil {
		return err
	}

	manager := peers.Options{Storage: storage.NewPeers(kvd)}.Build(c.API())
	dialogList := make([]*chat.Dialog, 0, len(dialogs))
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
			return fmt.Errorf("failed to run filter: %w", err)
		}
		if !b.(bool) {
			continue
		}

		dialogList = append(dialogList, r)
	}

	*result = dialogList
	return nil
}

// 辅助方法，从chat包复制过来
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

	// 创建Telegram客户端
	client, err := h.createTelegramClient()
	if err != nil {
		logctx.From(h.ctx).Error("Failed to create telegram client", zap.Error(err))
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
		err := client.Run(h.ctx, func(ctx context.Context) error {
			return chat.Export(ctx, client, h.kvStore, exportOpts)
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

	// 创建Telegram客户端
	client, err := h.createTelegramClient()
	if err != nil {
		logctx.From(h.ctx).Error("Failed to create telegram client", zap.Error(err))
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
		err := client.Run(h.ctx, func(ctx context.Context) error {
			return chat.Users(ctx, client, h.kvStore, usersOpts)
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