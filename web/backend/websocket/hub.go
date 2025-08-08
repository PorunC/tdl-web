package websocket

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"

	"github.com/iyear/tdl/core/logctx"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// 在生产环境中应该检查Origin
		return true
	},
}

// 消息类型
const (
	MessageTypeProgress    = "progress"
	MessageTypeTaskStart   = "task_start"
	MessageTypeTaskEnd     = "task_end"
	MessageTypeTaskError   = "task_error"
	MessageTypeNotification = "notification"
)

// WebSocket消息格式
type Message struct {
	Type      string      `json:"type"`
	Data      interface{} `json:"data"`
	Timestamp int64       `json:"timestamp"`
}

// 进度数据
type ProgressData struct {
	TaskID      string  `json:"task_id"`
	Progress    float64 `json:"progress"`
	Speed       string  `json:"speed"`
	ETA         string  `json:"eta"`
	Transferred int64   `json:"transferred"`
	Total       int64   `json:"total"`
}

// 任务状态数据
type TaskData struct {
	TaskID   string `json:"task_id"`
	TaskType string `json:"task_type"`
	Status   string `json:"status"`
	Message  string `json:"message,omitempty"`
}

// Client 表示一个WebSocket客户端
type Client struct {
	hub    *Hub
	conn   *websocket.Conn
	send   chan []byte
	userID string
}

// Hub 管理所有WebSocket连接
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan []byte),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			
		case message := <-h.broadcast:
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

// BroadcastProgress 广播进度更新
func (h *Hub) BroadcastProgress(data ProgressData) {
	msg := Message{
		Type:      MessageTypeProgress,
		Data:      data,
		Timestamp: time.Now().Unix(),
	}
	h.broadcastMessage(msg)
}

// BroadcastTaskStatus 广播任务状态
func (h *Hub) BroadcastTaskStatus(msgType string, data TaskData) {
	msg := Message{
		Type:      msgType,
		Data:      data,
		Timestamp: time.Now().Unix(),
	}
	h.broadcastMessage(msg)
}

// BroadcastNotification 广播通知
func (h *Hub) BroadcastNotification(message string, level string) {
	msg := Message{
		Type: MessageTypeNotification,
		Data: map[string]string{
			"message": message,
			"level":   level,
		},
		Timestamp: time.Now().Unix(),
	}
	h.broadcastMessage(msg)
}

func (h *Hub) broadcastMessage(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.broadcast <- data
}

func HandleWebSocket(hub *Hub) gin.HandlerFunc {
	return func(c *gin.Context) {
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			logctx.From(c.Request.Context()).Error("WebSocket upgrade failed", zap.Error(err))
			return
		}

		client := &Client{
			hub:    hub,
			conn:   conn,
			send:   make(chan []byte, 256),
			userID: c.GetString("user_id"), // 从中间件获取用户ID
		}

		client.hub.register <- client

		// 启动读写协程
		go client.writePump()
		go client.readPump()
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}