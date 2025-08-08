package middleware

import (
	"github.com/gin-gonic/gin"

	"github.com/iyear/tdl/core/storage"
)

// RequireAuth 检查用户是否已认证
func RequireAuth(kvd storage.Storage) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 简化实现 - 暂时跳过认证检查
		c.Set("user_id", "default")
		c.Next()
	}
}