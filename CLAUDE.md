# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

tdl (Telegram Downloader) is a Go CLI application for downloading, uploading, and managing Telegram content. It's designed as a high-performance alternative to official clients with features like file downloads from protected chats, message forwarding, and content export. The project now includes a modern web interface alongside the CLI.

## Architecture

The project uses a modular Go workspace architecture with three main modules plus a web interface:
- **Root module** (`github.com/iyear/tdl`): Main CLI application and high-level commands
- **Core module** (`core/`): Core Telegram client functionality, storage, and utilities  
- **Extension module** (`extension/`): Plugin system for extending functionality
- **Web Interface** (`web/`): Modern React frontend with Go API backend

### Key Components

- **CLI Commands** (`cmd/`): Cobra-based command definitions (login, download, upload, chat, forward, web, etc.)
- **App Logic** (`app/`): Business logic for each command category
- **Core Services** (`core/`):
  - `tclient/`: Telegram client wrapper and session management
  - `storage/`: Storage interfaces and implementations
  - `downloader/`, `uploader/`, `forwarder/`: Transfer engines with progress tracking
  - `middlewares/`: Request middleware (retry, recovery, rate limiting)
- **Packages** (`pkg/`): Shared utilities and libraries
- **Extensions** (`extension/`): Plugin system for third-party extensions
- **Web Interface** (`web/`):
  - `backend/`: Gin-based REST API and WebSocket server
  - `frontend/`: React/TypeScript SPA with Tailwind CSS and Radix-UI

### Storage System

The application uses a KV storage abstraction (`pkg/kv/`) with multiple backends:
- Bolt DB (default): `kv.DriverBolt`
- Legacy file-based: `kv.DriverLegacy` 
- Automatic migration from legacy to Bolt storage

## Development Commands

### CLI Development
```bash
# Build single target with goreleaser
make build

# Build all packages
make packaging

# Direct go build
go build -o tdl main.go

# Run specific CLI command
go run main.go login
go run main.go dl --help
```

### Web Interface Development
```bash
# Start full development environment (frontend + backend)
./scripts/dev-web.sh

# Frontend only (React dev server)
cd web/frontend && npm run dev

# Backend only (API server)
go run main.go web --port 8080 --debug

# Build production web interface
./scripts/build-web.sh

# Test web API endpoints
./scripts/test-web.sh
```

### Testing
```bash
# Run all tests
go test ./...

# Run tests for specific package
go test ./pkg/texpr

# Run integration tests (requires test server)
go test ./test/...

# Run tests with verbose output
go test -v ./...

# Frontend tests
cd web/frontend && npm test
```

### Working with Go Workspace
```bash
# Sync workspace dependencies
go work sync

# Tidy all modules
go mod tidy && cd core && go mod tidy && cd ../extension && go mod tidy

# Update dependencies across workspace
go get -u ./...
```

## Key Development Patterns

### Command Structure
All CLI commands follow this pattern:
- Command definition in `cmd/*.go`
- Business logic in corresponding `app/` subdirectory
- Use `tRun()` helper for Telegram client setup
- Implement progress tracking with `prog` package

### Web API Structure
The web interface follows REST API patterns:
- API handlers in `web/backend/api/`
- Middleware for auth, CORS, logging in `web/backend/middleware/`
- WebSocket for real-time updates in `web/backend/websocket/`
- Unified response format with `Success()`, `Error()` helpers

### Error Handling
- Use `github.com/go-faster/errors` for error wrapping
- Chain errors with context using `errors.Wrap()`
- Log errors through structured logging (`go.uber.org/zap`)
- Web APIs return JSON error responses with proper HTTP status codes

### Context Usage
The application heavily uses context for:
- Logger injection via `logctx` package
- KV storage access via `kv.From(ctx)`
- Telegram client lifecycle management
- Request context propagation in web APIs

### Storage Operations
```go
// Get storage from context
stg := kv.From(ctx)

// Open namespace
ns, err := stg.Open("namespace")

// Perform operations
err = ns.Set("key", []byte("value"))
```

### Web Frontend Patterns
- State management with Zustand stores (`useAuthStore`, `useTaskStore`)
- Real-time updates via WebSocket hook (`useWebSocket`)
- UI components using Radix-UI primitives with Tailwind CSS
- TypeScript for type safety across frontend

## Testing Infrastructure

- Main test suite in `test/` with integration tests
- Unit tests alongside source files (`*_test.go`)
- Test server implementation in `test/testserver/`
- Uses Ginkgo/Gomega testing framework for integration tests
- Frontend testing with React Testing Library (if configured)

## Configuration

- Uses Viper for configuration management
- Environment variables prefixed with `TDL_`
- Global flags in `cmd/root.go` with persistent flag binding
- Storage configuration via `--storage` flag with driver-specific options
- Web interface environment variables in `web/frontend/.env`

## Extension System

Extensions are Go plugins that can be:
- Loaded from local filesystem (`~/.tdl/extensions/`)
- Downloaded from GitHub repositories
- Managed via `tdl extension` commands

Each extension must implement the extension interface defined in `extension/extension.go`.

## Web Interface Architecture

### Backend (Go + Gin)
- REST API endpoints under `/api/v1/`
- WebSocket endpoint at `/ws` for real-time communication
- CORS-enabled for frontend development
- Structured logging and error handling

### Frontend (React + TypeScript)
- Modern React 18 with TypeScript
- Tailwind CSS for styling
- Radix-UI for accessible components
- Vite for build tooling and development server
- Zustand for client state management
- Axios for API communication

### Key API Endpoints
- Authentication: `/api/v1/auth/*`
- Download management: `/api/v1/download/*`
- Upload management: `/api/v1/upload/*`
- Settings: `/api/v1/settings/`
- WebSocket: `/ws` (progress updates, notifications)

### WebSocket Message Types
- `progress`: Task progress updates
- `task_start`, `task_end`, `task_error`: Task lifecycle events
- `notification`: General notifications

## Development Workflow

1. **CLI Development**: Work directly with Go commands and test with `go run main.go <command>`
2. **Web Development**: Use `./scripts/dev-web.sh` for hot-reload development
3. **Integration**: Web backend currently uses mock data - gradually integrate with real tdl CLI functionality
4. **Testing**: Run both Go tests and frontend tests before committing

## Project Features

Core tdl features include:
- Single file start-up with low resource usage
- High-speed downloads (faster than official clients)
- Download files from protected chats
- Message forwarding with automatic fallback
- Upload files to Telegram
- Export messages/members/subscribers to JSON
- Web interface for modern UI experience