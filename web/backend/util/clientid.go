package util

import (
	"net"
	"strings"
)

// SafeClientID 将客户端IP地址转换为文件系统安全的标识符
// IPv4: 192.168.1.1 -> 192-168-1-1
// IPv6: ::1 -> __1, 2001:db8::1 -> 2001_db8__1
func SafeClientID(clientIP string) string {
	// 首先检查是否包含冒号，可能是IPv6地址
	if strings.Contains(clientIP, ":") {
		// 尝试解析为IP地址
		if ip := net.ParseIP(clientIP); ip != nil {
			// 有效的IPv6地址：将冒号替换为下划线
			return strings.ReplaceAll(clientIP, ":", "_")
		}
		// 包含冒号但不是有效IP地址，可能是带接口的IPv6
		// 直接进行冒号替换，避免复杂的字符串处理
		return strings.ReplaceAll(clientIP, ":", "_")
	}

	// 检查是否是IPv4地址
	if ip := net.ParseIP(clientIP); ip != nil && ip.To4() != nil {
		return strings.ReplaceAll(clientIP, ".", "-")
	}

	// 其他情况使用通用清理
	return sanitizeString(clientIP)
}

// RestoreClientIP 从安全标识符还原客户端IP地址
func RestoreClientIP(safeID string) string {
	// 检查是否包含破折号（IPv4）
	if strings.Contains(safeID, "-") && !strings.Contains(safeID, "_") {
		return strings.ReplaceAll(safeID, "-", ".")
	}

	// 检查是否包含下划线（IPv6）
	if strings.Contains(safeID, "_") {
		return strings.ReplaceAll(safeID, "_", ":")
	}

	// 无法识别，直接返回
	return safeID
}

// sanitizeString 清理字符串中的文件系统不安全字符
func sanitizeString(s string) string {
	// Windows文件系统不允许的字符: < > : " | ? * \ /
	replacements := map[string]string{
		":":  "_colon_",
		"<":  "_lt_",
		">":  "_gt_",
		"\"": "_quote_",
		"|":  "_pipe_",
		"?":  "_question_",
		"*":  "_star_",
		"\\": "_backslash_",
		"/":  "_slash_",
	}

	result := s
	for old, new := range replacements {
		result = strings.ReplaceAll(result, old, new)
	}

	return result
}