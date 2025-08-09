# TDL Web Build Script for Windows
# PowerShell equivalent of build-web.sh

param(
    [switch]$Help,
    [switch]$Clean
)

if ($Help) {
    Write-Host "TDL Web Build Script"
    Write-Host "Usage: .\build-web.ps1 [-Clean] [-Help]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Clean    Clean build artifacts before building"
    Write-Host "  -Help     Show this help message"
    exit 0
}

# Set error action preference
$ErrorActionPreference = "Stop"

# Color functions
function Write-Info {
    param($Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Error {
    param($Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Step {
    param($Message)
    Write-Host "🔨 $Message" -ForegroundColor Cyan
}

function Write-Success {
    param($Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

# Clean function
function Clean-BuildArtifacts {
    Write-Info "Cleaning build artifacts..."
    
    # Clean frontend build
    if (Test-Path "web\frontend\dist") {
        Remove-Item -Path "web\frontend\dist" -Recurse -Force
        Write-Info "Cleaned frontend dist directory"
    }
    
    # Clean Go build
    if (Test-Path "tdl-web.exe") {
        Remove-Item -Path "tdl-web.exe" -Force
        Write-Info "Cleaned Go binary"
    }
    
    # Clean node_modules if requested
    if ($Clean -and (Test-Path "web\frontend\node_modules")) {
        Write-Info "Cleaning node_modules..."
        Remove-Item -Path "web\frontend\node_modules" -Recurse -Force
        Write-Info "Cleaned node_modules directory"
    }
}

# Check dependencies
function Test-Dependencies {
    Write-Info "Checking build dependencies..."
    
    # Check Node.js
    try {
        $nodeVersion = node --version
        Write-Info "Node.js: $nodeVersion"
    } catch {
        Write-Error "Node.js is not installed. Please install Node.js 18 or later."
        exit 1
    }
    
    # Check npm
    try {
        $npmVersion = npm --version
        Write-Info "npm: $npmVersion"
    } catch {
        Write-Error "npm is not installed."
        exit 1
    }
    
    # Check Go
    try {
        $goVersion = go version
        Write-Info "Go: $goVersion"
    } catch {
        Write-Error "Go is not installed. Please install Go 1.23 or later."
        exit 1
    }
}

# Build frontend
function Build-Frontend {
    Write-Step "Building frontend..."
    
    Push-Location "web\frontend"
    try {
        # Install dependencies
        Write-Info "Installing frontend dependencies..."
        npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed"
        }
        
        # Build frontend
        Write-Info "Building React application..."
        npm run build
        if ($LASTEXITCODE -ne 0) {
            throw "npm run build failed"
        }
        
        # Verify build output
        if (!(Test-Path "dist")) {
            throw "Frontend build failed - dist directory not found"
        }
        
        Write-Success "Frontend build completed"
        
    } catch {
        Write-Error "Frontend build failed: $($_.Exception.Message)"
        exit 1
    } finally {
        Pop-Location
    }
}

# Build backend
function Build-Backend {
    Write-Step "Building backend with embedded frontend..."
    
    try {
        # Build Go application with web tag
        Write-Info "Compiling Go application..."
        go build -tags web -o tdl-web.exe main.go
        if ($LASTEXITCODE -ne 0) {
            throw "go build failed"
        }
        
        # Verify binary exists
        if (!(Test-Path "tdl-web.exe")) {
            throw "Backend build failed - binary not found"
        }
        
        # Get file size
        $fileSize = (Get-Item "tdl-web.exe").Length
        $fileSizeMB = [math]::Round($fileSize / 1MB, 2)
        
        Write-Success "Backend build completed (${fileSizeMB}MB)"
        
    } catch {
        Write-Error "Backend build failed: $($_.Exception.Message)"
        exit 1
    }
}

# Main function
function Main {
    Write-Host "🚀 Building TDL Web Interface..." -ForegroundColor Yellow
    Write-Host ""
    
    try {
        # Clean if requested
        if ($Clean) {
            Clean-BuildArtifacts
            Write-Host ""
        }
        
        # Check dependencies
        Test-Dependencies
        Write-Host ""
        
        # Build frontend
        Build-Frontend
        Write-Host ""
        
        # Build backend
        Build-Backend
        Write-Host ""
        
        # Final success message
        Write-Host "🎉 Build completed successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "To start the web interface:" -ForegroundColor Cyan
        Write-Host "  .\tdl-web.exe web" -ForegroundColor White
        Write-Host ""
        Write-Host "Default URLs:" -ForegroundColor Cyan
        Write-Host "  Web Interface: http://localhost:8080" -ForegroundColor White
        Write-Host "  API Endpoints: http://localhost:8080/api/v1/" -ForegroundColor White
        Write-Host "  WebSocket:     ws://localhost:8080/ws" -ForegroundColor White
        
    } catch {
        Write-Error "Build failed: $($_.Exception.Message)"
        exit 1
    }
}

# Run main function
Main