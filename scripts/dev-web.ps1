# TDL Web Development Script for Windows
# PowerShell equivalent of dev-web.sh

param(
    [switch]$Help
)

if ($Help) {
    Write-Host "TDL Web Development Script"
    Write-Host "Usage: .\dev-web.ps1"
    Write-Host "This script starts both frontend and backend development servers"
    exit 0
}

# Set error action preference
$ErrorActionPreference = "Stop"

# Color functions
function Write-Info {
    param($Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Warn {
    param($Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param($Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# Global variables for cleanup
$script:FrontendJob = $null

# Cleanup function
function Cleanup {
    Write-Info "Cleaning up..."
    if ($script:FrontendJob) {
        Write-Info "Stopping frontend server..."
        Stop-Job $script:FrontendJob -ErrorAction SilentlyContinue
        Remove-Job $script:FrontendJob -Force -ErrorAction SilentlyContinue
        
        # Kill npm processes on port 3000
        $processes = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | 
                    Select-Object -ExpandProperty OwningProcess | 
                    ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
        $processes | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

# Set up Ctrl+C handler
$null = Register-EngineEvent PowerShell.Exiting -Action { Cleanup }

# Trap for cleanup on exit
trap {
    Cleanup
    break
}

# Check dependencies function
function Test-Dependencies {
    Write-Info "Checking dependencies..."
    
    # Check Node.js
    try {
        $nodeVersion = node --version
        Write-Info "Node.js found: $nodeVersion"
    } catch {
        Write-Error "Node.js is not installed. Please install Node.js 18 or later."
        Write-Host "Download from: https://nodejs.org/"
        exit 1
    }
    
    # Check npm
    try {
        $npmVersion = npm --version
        Write-Info "npm found: $npmVersion"
    } catch {
        Write-Error "npm is not installed. Please install npm."
        exit 1
    }
    
    # Check Go
    try {
        $goVersion = go version
        Write-Info "Go found: $goVersion"
    } catch {
        Write-Error "Go is not installed. Please install Go 1.23 or later."
        Write-Host "Download from: https://golang.org/dl/"
        exit 1
    }
    
    Write-Info "All dependencies are available."
}

# Main function
function Main {
    try {
        Test-Dependencies
        
        # Check and install frontend dependencies
        if (!(Test-Path "web\frontend\node_modules")) {
            Write-Info "Installing frontend dependencies..."
            Push-Location "web\frontend"
            try {
                npm install
                if ($LASTEXITCODE -ne 0) {
                    throw "npm install failed"
                }
            } finally {
                Pop-Location
            }
        } else {
            Write-Info "Frontend dependencies already installed."
        }
        
        # Start frontend development server in background
        Write-Info "Starting frontend development server..."
        Push-Location "web\frontend"
        try {
            $script:FrontendJob = Start-Job -ScriptBlock {
                Set-Location $using:PWD
                npm run dev 2>&1 | Out-File -FilePath "vite.log" -Encoding utf8
            }
        } finally {
            Pop-Location
        }
        
        # Wait for frontend server to start
        Write-Info "Waiting for frontend server to start..."
        Start-Sleep -Seconds 5
        
        # Check if frontend server is running
        $frontendRunning = $false
        for ($i = 0; $i -lt 10; $i++) {
            try {
                $response = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 2 -ErrorAction SilentlyContinue
                if ($response.StatusCode -eq 200) {
                    $frontendRunning = $true
                    break
                }
            } catch {
                # Continue trying
            }
            Start-Sleep -Seconds 1
        }
        
        if (!$frontendRunning) {
            Write-Error "Frontend server failed to start. Check web\frontend\vite.log for details:"
            if (Test-Path "web\frontend\vite.log") {
                Get-Content "web\frontend\vite.log" | Select-Object -Last 20
            } else {
                Write-Host "Log file not found"
            }
            exit 1
        }
        
        Write-Info "Frontend server started successfully"
        Write-Info "Frontend URL: http://localhost:3000"
        Write-Info "API Proxy: http://localhost:3000/api -> http://localhost:8080/api"
        
        # Start backend server
        Write-Info "Starting backend server..."
        Write-Info "Backend URL: http://localhost:8080"
        Write-Host ""
        Write-Host "Press Ctrl+C to stop all servers" -ForegroundColor Cyan
        Write-Host ""
        
        # Run backend server (this will block)
        go run main.go web --port 8080 --debug
        
    } catch {
        Write-Error "Error: $($_.Exception.Message)"
        exit 1
    } finally {
        Cleanup
    }
}

# Run main function
Main