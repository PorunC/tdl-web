#!/bin/bash

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日志函数
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 检查必要的工具
check_dependencies() {
    log_info "Checking dependencies..."
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js 18 or later."
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed. Please install npm."
        exit 1
    fi
    
    if ! command -v go &> /dev/null; then
        log_error "Go is not installed. Please install Go 1.21 or later."
        exit 1
    fi
    
    log_info "All dependencies are available."
}

# 清理函数
cleanup() {
    log_info "Cleaning up..."
    if [[ ! -z "$FRONTEND_PID" ]]; then
        log_info "Stopping frontend server (PID: $FRONTEND_PID)..."
        kill $FRONTEND_PID 2>/dev/null || true
        wait $FRONTEND_PID 2>/dev/null || true
    fi
    exit 0
}

# 设置信号处理
trap cleanup SIGINT SIGTERM EXIT

# 主函数
main() {
    check_dependencies
    
    # 检查并安装前端依赖
    if [ ! -d "web/frontend/node_modules" ]; then
        log_info "Installing frontend dependencies..."
        cd web/frontend
        npm install || {
            log_error "Failed to install frontend dependencies"
            exit 1
        }
        cd ../..
    else
        log_info "Frontend dependencies already installed."
    fi
    
    # 启动前端开发服务器（后台）
    log_info "Starting frontend development server..."
    cd web/frontend
    npm run dev > ./vite.log 2>&1 &
    FRONTEND_PID=$!
    cd ../..
    
    # 等待前端服务器启动
    log_info "Waiting for frontend server to start..."
    sleep 5
    
    # 检查前端服务器是否成功启动
    if ! kill -0 $FRONTEND_PID 2>/dev/null; then
        log_error "Frontend server failed to start. Check web/frontend/vite.log for details:"
        cat web/frontend/vite.log 2>/dev/null || echo "Log file not found"
        exit 1
    fi
    
    log_info "Frontend server started successfully (PID: $FRONTEND_PID)"
    log_info "Frontend URL: http://localhost:3000"
    log_info "API Proxy: http://localhost:3000/api -> http://localhost:8080/api"
    
    # 启动后端服务器
    log_info "Starting backend server..."
    log_info "Backend URL: http://localhost:8080"
    
    # 运行后端服务器（这将阻塞）
    go run main.go web --port 8080 --debug
}

main "$@"