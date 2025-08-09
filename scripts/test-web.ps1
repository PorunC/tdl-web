# TDL Web Test Script for Windows
# PowerShell equivalent of test-web.sh

param(
    [switch]$Help,
    [string]$BaseUrl = "http://localhost:8080",
    [int]$Timeout = 30
)

if ($Help) {
    Write-Host "TDL Web Test Script"
    Write-Host "Usage: .\test-web.ps1 [-BaseUrl <url>] [-Timeout <seconds>] [-Help]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -BaseUrl    Base URL for API testing (default: http://localhost:8080)"
    Write-Host "  -Timeout    Request timeout in seconds (default: 30)"
    Write-Host "  -Help       Show this help message"
    exit 0
}

# Color functions
function Write-Info {
    param($Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Error {
    param($Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Success {
    param($Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor Green
}

function Write-Header {
    param($Message)
    Write-Host ""
    Write-Host "🔍 $Message" -ForegroundColor Cyan
    Write-Host ("=" * 50) -ForegroundColor Gray
}

# Test API endpoint
function Test-ApiEndpoint {
    param(
        [string]$Url,
        [string]$Description,
        [string]$Method = "GET",
        [hashtable]$Headers = @{},
        [object]$Body = $null
    )
    
    Write-Host "Testing: $Description" -ForegroundColor Yellow
    Write-Host "URL: $Url" -ForegroundColor Gray
    
    try {
        $params = @{
            Uri = $Url
            Method = $Method
            TimeoutSec = $Timeout
            Headers = $Headers
        }
        
        if ($Body) {
            $params.Body = $Body | ConvertTo-Json
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-RestMethod @params
        Write-Success "✅ $Description - OK"
        
        # Pretty print JSON response if it's an object
        if ($response -is [PSCustomObject] -or $response -is [hashtable]) {
            $jsonOutput = $response | ConvertTo-Json -Depth 3
            Write-Host $jsonOutput -ForegroundColor White
        } else {
            Write-Host $response -ForegroundColor White
        }
        
        return $true
    } catch {
        Write-Error "❌ $Description - FAILED"
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Test WebSocket connection
function Test-WebSocket {
    param([string]$WsUrl)
    
    Write-Host "Testing: WebSocket Connection" -ForegroundColor Yellow
    Write-Host "URL: $WsUrl" -ForegroundColor Gray
    
    try {
        # Simple WebSocket test using .NET WebSocket
        Add-Type -AssemblyName System.Net.WebSockets
        Add-Type -AssemblyName System.Threading.Tasks
        
        $ws = New-Object System.Net.WebSockets.ClientWebSocket
        $ct = New-Object System.Threading.CancellationToken
        
        $connectTask = $ws.ConnectAsync($WsUrl, $ct)
        $connectTask.Wait(5000)  # 5 second timeout
        
        if ($ws.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            Write-Success "✅ WebSocket Connection - OK"
            $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "Test complete", $ct).Wait()
            return $true
        } else {
            Write-Error "❌ WebSocket Connection - FAILED (State: $($ws.State))"
            return $false
        }
    } catch {
        Write-Error "❌ WebSocket Connection - FAILED"
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Check server status
function Test-ServerRunning {
    param([string]$Url)
    
    Write-Host "Checking if server is running at $Url..." -ForegroundColor Yellow
    
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -ErrorAction Stop
        return $true
    } catch {
        Write-Error "Server is not running at $Url"
        Write-Host "Please start the server with: go run main.go web --port 8080 --debug" -ForegroundColor Cyan
        return $false
    }
}

# Main function
function Main {
    Write-Host "🚀 Testing TDL Web Interface..." -ForegroundColor Yellow
    Write-Host ""
    
    # Check if server is running
    if (!(Test-ServerRunning $BaseUrl)) {
        exit 1
    }
    
    $successCount = 0
    $totalTests = 0
    
    # Test Backend API
    Write-Header "Testing Backend API Endpoints"
    
    # Auth Status API
    $totalTests++
    if (Test-ApiEndpoint -Url "$BaseUrl/api/v1/auth/status" -Description "Auth Status API") {
        $successCount++
    }
    
    Write-Host ""
    
    # Download Chats API  
    $totalTests++
    if (Test-ApiEndpoint -Url "$BaseUrl/api/v1/download/chats" -Description "Download Chats API") {
        $successCount++
    }
    
    Write-Host ""
    
    # WebSocket Test
    Write-Header "Testing WebSocket Connection"
    $wsUrl = $BaseUrl -replace "^http", "ws"
    $totalTests++
    if (Test-WebSocket -WsUrl "$wsUrl/ws") {
        $successCount++
    }
    
    # Display server information
    Write-Header "Server Information"
    Write-Host "🌐 Access URLs:" -ForegroundColor Cyan
    Write-Host "Frontend (if running): http://localhost:3000" -ForegroundColor White
    Write-Host "Backend (API):         $BaseUrl" -ForegroundColor White
    Write-Host "WebSocket:             $($BaseUrl -replace '^http', 'ws')/ws" -ForegroundColor White
    Write-Host ""
    
    Write-Host "📋 Available API Endpoints:" -ForegroundColor Cyan
    $endpoints = @(
        "GET  /api/v1/auth/status",
        "POST /api/v1/auth/qr/start", 
        "GET  /api/v1/auth/qr/code/:sessionId",
        "GET  /api/v1/auth/qr/status/:sessionId",
        "POST /api/v1/auth/code/start",
        "POST /api/v1/auth/code/verify",
        "POST /api/v1/auth/password/verify",
        "POST /api/v1/auth/logout",
        "GET  /api/v1/chat/list",
        "POST /api/v1/chat/export",
        "POST /api/v1/chat/users",
        "GET  /ws (WebSocket)"
    )
    
    foreach ($endpoint in $endpoints) {
        Write-Host "- $endpoint" -ForegroundColor White
    }
    
    # Summary
    Write-Header "Test Summary"
    if ($successCount -eq $totalTests) {
        Write-Success "🎉 All tests passed! ($successCount/$totalTests)"
        Write-Host "TDL Web Interface is ready for development!" -ForegroundColor Green
    } else {
        Write-Error "❌ Some tests failed! ($successCount/$totalTests passed)"
        Write-Host "Please check the server logs for more details." -ForegroundColor Yellow
        exit 1
    }
}

# Run main function
Main