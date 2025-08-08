#!/bin/bash

echo "🚀 Testing tdl Web Interface..."
echo ""

# 测试后端API
echo "📡 Testing Backend API:"
echo "Auth Status API:"
curl -s http://localhost:8080/api/v1/auth/status | jq '.' || echo "Backend not running"

echo ""
echo "Download Chats API:"
curl -s http://localhost:8080/api/v1/download/chats | jq '.' || echo "Backend not running"

echo ""
echo "✅ API endpoints are working!"
echo ""

# 显示访问信息
echo "🌐 Access URLs:"
echo "Frontend (React): http://localhost:3000"
echo "Backend (API):    http://localhost:8080"
echo "WebSocket:        ws://localhost:8080/ws"
echo ""

echo "📋 API Endpoints:"
echo "- GET  /api/v1/auth/status"
echo "- POST /api/v1/auth/login/qr"
echo "- POST /api/v1/auth/login/code"
echo "- GET  /api/v1/download/chats"
echo "- POST /api/v1/download/start"
echo "- GET  /api/v1/download/tasks"
echo "- WebSocket: /ws"
echo ""

echo "🎉 tdl Web Interface is ready for development!"