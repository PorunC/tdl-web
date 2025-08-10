package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/iyear/tdl/core/logctx"
)

// 统一API响应格式
type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Message string      `json:"message,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// 成功响应
func Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, Response{
		Success: true,
		Data:    data,
	})
}

// 成功响应带消息
func SuccessWithMessage(c *gin.Context, data interface{}, message string) {
	c.JSON(http.StatusOK, Response{
		Success: true,
		Data:    data,
		Message: message,
	})
}

// 错误响应
func Error(c *gin.Context, code int, err error) {
	logctx.From(c.Request.Context()).Error("API Error", 
		zap.Error(err))
	
	c.JSON(code, Response{
		Success: false,
		Error:   err.Error(),
	})
}

// 参数验证错误
func ValidationError(c *gin.Context, message string) {
	c.JSON(http.StatusBadRequest, Response{
		Success: false,
		Error:   message,
	})
}

// 内部服务器错误响应
func InternalServerError(c *gin.Context, message string) {
	c.JSON(http.StatusInternalServerError, Response{
		Success: false,
		Error:   message,
	})
}

// 内部服务器错误响应带详细错误信息
func InternalError(c *gin.Context, message string, err error) {
	logctx.From(c.Request.Context()).Error("API Error", 
		zap.String("message", message),
		zap.Error(err))
	
	c.JSON(http.StatusInternalServerError, Response{
		Success: false,
		Error:   message + ": " + err.Error(),
	})
}

// 未找到错误响应
func NotFoundError(c *gin.Context, message string) {
	c.JSON(http.StatusNotFound, Response{
		Success: false,
		Error:   message,
	})
}

// 获取分页参数
func GetPagination(c *gin.Context) (offset, limit int) {
	// 简化实现
	offset = 0
	limit = 20
	return
}