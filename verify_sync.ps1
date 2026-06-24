Write-Host "============================================="
Write-Host "     Git Auto-Sync Verification Script       "
Write-Host "============================================="

# Detect base path
$BaseDir = Split-Path -Qualifier $PSScriptRoot
if ($BaseDir -notlike "*:") {
    $BaseDir = "E:\"
} else {
    $BaseDir = "$BaseDir\"
}
if ($env:TEST_E_DRIVE_PATH) {
    $BaseDir = $env:TEST_E_DRIVE_PATH
}

Write-Host "[+] Target Directory to scan: $BaseDir"

# Check if daemon lock file exists (which contains PID if daemon is active)
$LockFile = Join-Path $BaseDir ".sync.lock"
if (Test-Path $LockFile) {
    try {
        $pidNum = (Get-Content $LockFile -Raw).Trim()
        Write-Host "[+] Daemon status: RUNNING (PID $pidNum)" -ForegroundColor Green
    } catch {
        Write-Host "[!] Daemon status: RUNNING (Unable to read PID)" -ForegroundColor Green
    }
} else {
    Write-Host "[!] Daemon status: NOT RUNNING" -ForegroundColor Yellow
    Write-Host "Please start the daemon using launcher.vbs or run install.ps1 first."
}

# Run a quick check on Git configuration
Write-Host "[+] Checking Git credentials..."
$gcm = git config --global credential.helper
Write-Host "[+] Credential Helper: $gcm"

Write-Host "[SUCCESS] Verification script executed successfully."
exit 0
