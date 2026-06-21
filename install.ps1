param(
    [switch]$TestMode
)

# Set the registry key name based on test mode
$RegistryKeyName = if ($TestMode) { "GitAutoSync_Test" } else { "GitAutoSync" }

# Resolve the installation directory dynamically
$InstallDir = $PSScriptRoot
if (-not $InstallDir) {
    $InstallDir = "E:\git_auto_sync_service"
}

Write-Host "============================================="
Write-Host "    Installing Git Auto-Sync Service...      "
Write-Host "============================================="
Write-Host "Installation path: $InstallDir"
Write-Host "Registry entry name: $RegistryKeyName"

# 1. Check if Node.js is installed (Required by E2E test TC-T2-22)
Write-Host "[+] Checking if Node.js is installed..."
$nodeCheck = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $nodeCheck) {
    Write-Error "Node.js is not installed or not in PATH. Please install Node.js."
    exit 1
} else {
    Write-Host "[+] Node.js detected: $($nodeCheck.Source)"
}

# 2. Check if Git is installed
Write-Host "[+] Checking if Git is installed..."
$gitCheck = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCheck) {
    Write-Error "Git is not installed or not in PATH. Please install Git."
    exit 1
}

# 3. Check and configure Git Credential Manager (GCM)
Write-Host "[+] Checking global Git credential helper..."
$gcm = git config --global credential.helper
if ($null -eq $gcm -or $gcm -eq "") {
    Write-Host "[+] Enabling Git Credential Manager..."
    git config --global credential.helper manager
} else {
    Write-Host "[+] Credential helper already configured: $gcm"
}

# 4. Register Startup Launcher in HKCU:\Software\Microsoft\Windows\CurrentVersion\Run
$LauncherPath = Join-Path $InstallDir "launcher.vbs"
$RegistryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RegistryValue = "wscript.exe `"$LauncherPath`""

if (Test-Path $LauncherPath) {
    Write-Host "[+] Registering startup run key registry entry..."
    Set-ItemProperty -Path $RegistryPath -Name $RegistryKeyName -Value $RegistryValue -Force
    Write-Host "[+] Registered: $RegistryKeyName -> $RegistryValue"
} else {
    Write-Error "Launcher script not found at $LauncherPath"
    exit 1
}

# 5. Create initial sync.log if base directory is E:\ and sync.log is missing
$LogPath = "E:\git_auto_sync_service\sync.log"
if (-not (Test-Path $LogPath)) {
    try {
        $parentDir = Split-Path $LogPath
        if (-not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
        }
        New-Item -ItemType File -Force -Path $LogPath | Out-Null
        Write-Host "[+] Created sync.log file."
    } catch {
        Write-Warning "Could not create initial sync.log: $_"
    }
}

# 6. Create Desktop Shortcut for Web Dashboard
if (-not $TestMode) {
    Write-Host "[+] Creating Desktop Shortcut for Web Dashboard..."
    try {
        $DesktopPath = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), "Git Sync Dashboard.lnk")
        $WshShell = New-Object -ComObject WScript.Shell
        $Shortcut = $WshShell.CreateShortcut($DesktopPath)
        $Shortcut.TargetPath = "cmd.exe"
        $Shortcut.Arguments = "/c start http://localhost:3000"
        $Shortcut.Description = "Open Git Auto-Sync Dashboard"
        $Shortcut.IconLocation = "shell32.dll,13"
        $Shortcut.Save()
        Write-Host "[+] Created desktop shortcut: $DesktopPath"
    } catch {
        Write-Warning "Could not create Desktop shortcut: $_"
    }
}

Write-Host "[SUCCESS] Git Auto-Sync Service installation completed!"
exit 0
