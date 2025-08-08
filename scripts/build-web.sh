#!/bin/bash

set -e

echo "Building tdl web interface..."

# 构建前端
echo "Building frontend..."
cd web/frontend
npm install
npm run build
cd ../..

# 构建后端（包含前端静态资源）
echo "Building backend..."
go build -tags web -o tdl-web main.go

echo "Build completed! Run './tdl-web web' to start the web interface."