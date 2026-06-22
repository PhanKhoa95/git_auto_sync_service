@echo off
:: Set code page to UTF-8 to display Vietnamese correctly
chcp 65001 >nul
cd /d "%~dp0"

:MENU
cls
echo ==================================================
echo       Trình Khắc Phục Sự Cố Git Auto-Sync (Autopilot)
echo ==================================================
echo.
echo [1] Kiểm tra trạng thái dịch vụ (Daemon Status)
echo [2] Kiểm tra kết nối mạng (Internet & GitHub)
echo [3] Kiểm tra & Cấu hình danh tính Git (User Name/Email)
echo [4] Kiểm tra & Bật Trình quản lý Đăng nhập (GCM Helper)
echo [5] Kiểm tra & Sửa quyền bảo mật thư mục (safe.directory)
echo [6] Thử kết nối từ xa & Đăng nhập (Git Push dry-run)
echo [7] Xem nhật ký hoạt động (15 dòng log gần nhất)
echo [8] Thoát
echo.
echo ==================================================
set /p CHOICE="Chọn một tùy chọn (1-8): "

if "%CHOICE%"=="1" goto DAEMON_STATUS
if "%CHOICE%"=="2" goto NETWORK_CHECK
if "%CHOICE%"=="3" goto GIT_IDENTITY
if "%CHOICE%"=="4" goto GCM_HELPER
if "%CHOICE%"=="5" goto SAFE_DIR
if "%CHOICE%"=="6" goto REMOTE_AUTH
if "%CHOICE%"=="7" goto VIEW_LOGS
if "%CHOICE%"=="8" goto EXIT
goto MENU

:DAEMON_STATUS
echo.
echo === [1] KIỂM TRA TRẠNG THÁI DỊCH VỤ ===
echo.
netstat -ano | findstr "9999" | findstr "LISTENING" >nul
if %errorlevel%==0 (
    echo [+] Dịch vụ Web Dashboard đang chạy trên cổng 9999.
) else (
    echo [!] Dịch vụ Web Dashboard (cổng 9999) đang TẮT.
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "^
$configPath = '.\config.json';^
if (Test-Path $configPath) {^
    $cfg = Get-Content $configPath | ConvertFrom-Json;^
    $roots = $cfg.monitoredRoots;^
    Write-Host 'Monitored Roots: ' ($roots -join ', ');^
    foreach ($r in $roots) {^
        $lockFile = Join-Path $r '.sync.lock';^
        if (Test-Path $lockFile) {^
            $pid = (Get-Content $lockFile).Trim();^
            Write-Host \"[+] Tìm thấy file khóa tại $lockFile với PID $pid.\";^
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue;^
            if ($proc) {^
                Write-Host \"[+] Dịch vụ Daemon (PID $pid) đang HOẠT ĐỘNG thực tế.\";^
            } else {^
                Write-Host \"[!] File khóa tồn tại nhưng tiến trình (PID $pid) đã BỊ TẮT hoặc chết lâm sàng.\";^
            }^
        } else {^
            Write-Host \"[!] Không tìm thấy file khóa tại $r.\";^
        }^
    }^
} else {^
    Write-Host '[!] Không tìm thấy file config.json ở thư mục gốc.';^
}"
echo.
pause
goto MENU

:NETWORK_CHECK
echo.
echo === [2] KIỂM TRA KẾT NỐI MẠNG ===
echo.
echo Đang gửi gói tin kiểm tra kết nối tới github.com...
ping github.com -n 3
if %errorlevel%==0 (
    echo.
    echo [+] Kết nối Internet và GitHub tốt.
) else (
    echo.
    echo [!] KHÔNG THỂ kết nối tới github.com. Vui lòng kiểm tra lại đường truyền mạng của bạn.
)
echo.
pause
goto MENU

:GIT_IDENTITY
echo.
echo === [3] KIỂM TRA & CẤU HÌNH DANH TÍNH GIT ===
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "^
$name = git config --global user.name;^
$email = git config --global user.email;^
Write-Host 'Danh tính Git hiện tại:';^
Write-Host \"  - Tên người dùng: $(if ($name) { $name } else { '[CHƯA CẤU HÌNH]' })\";^
Write-Host \"  - Email:          $(if ($email) { $email } else { '[CHƯA CẤU HÌNH]' })\";^
Write-Host '';^
$ans = Read-Host 'Bạn có muốn cấu hình / thay đổi thông tin này không? (Y/N)';^
if ($ans -eq 'Y' -or $ans -eq 'y') {^
    $newName = Read-Host 'Nhập Git User Name mới';^
    $newEmail = Read-Host 'Nhập Git Email mới';^
    if ($newName) {^
        git config --global user.name $newName;^
    }^
    if ($newEmail) {^
        git config --global user.email $newEmail;^
    }^
    Write-Host '[+] Cập nhật cấu hình Git thành công!';^
}"
echo.
pause
goto MENU

:GCM_HELPER
echo.
echo === [4] KIỂM TRA & BẬT TRÌNH QUẢN LÝ ĐĂNG NHẬP ===
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "^
$gcm = git config --global credential.helper;^
Write-Host \"Trình quản lý đăng nhập hiện tại: $(if ($gcm) { $gcm } else { '(Chưa có)' })\";^
if ($gcm -ne 'manager') {^
    Write-Host '[!] Git Credential Manager (GCM) chưa được bật hoặc dùng giá trị khác.';^
    $ans = Read-Host 'Bạn có muốn kích hoạt Git Credential Manager (manager) không? (Y/N)';^
    if ($ans -eq 'Y' -or $ans -eq 'y') {^
        git config --global credential.helper manager;^
        Write-Host '[+] Đã kích hoạt thành công Git Credential Manager toàn cục.';^
    }^
} else {^
    Write-Host '[+] Git Credential Manager đã được cấu hình chính xác (credential.helper = manager).';^
}"
echo.
pause
goto MENU

:SAFE_DIR
echo.
echo === [5] KIỂM TRA & SỬA QUYỀN BẢO MẬT THƯ MỤC ===
echo.
echo Đang quét cấu hình safe.directory của Git...
powershell -NoProfile -ExecutionPolicy Bypass -Command "^
$safeDirs = git config --global --get-all safe.directory 2>$null;^
Write-Host 'Danh sách safe.directory hiện tại:';^
if ($safeDirs) {^
    foreach ($d in $safeDirs) { Write-Host \"  - $d\" };^
} else {^
    Write-Host '  (Trống)';^
}^
$configPath = '.\config.json';^
if (Test-Path $configPath) {^
    $cfg = Get-Content $configPath | ConvertFrom-Json;^
    $roots = $cfg.monitoredRoots;^
    foreach ($r in $roots) {^
        $resolved = (Resolve-Path $r).Path.Replace('\','/');^
        Write-Host \"`nĐang kiểm tra bảo mật thư mục: $resolved\";^
        $isSafe = $false;^
        if ($safeDirs) {^
            foreach ($sd in $safeDirs) {^
                if ($sd -eq '*' -or $sd -eq $resolved -or $sd.Replace('\','/') -eq $resolved) { $isSafe = $true; break; }^
            }^
        }^
        if ($isSafe) {^
            Write-Host \"[+] Thư mục $r đã an toàn.\";^
        } else {^
            Write-Host \"[!] Thư mục $r CHƯA được thêm vào safe.directory của Git.\";^
            $ans = Read-Host 'Bạn có muốn thêm thư mục này vào danh sách an toàn không? (Y/N)';^
            if ($ans -eq 'Y' -or $ans -eq 'y') {^
                git config --global --add safe.directory $resolved;^
                Write-Host \"[+] Đã thêm $resolved vào safe.directory.\";^
            }^
        }^
    }^
} else {^
    Write-Host '[!] Không tìm thấy file config.json.';^
}"
echo.
pause
goto MENU

:REMOTE_AUTH
echo.
echo === [6] THỬ KẾT NỐI TỪ XA & ĐĂNG NHẬP ===
echo.
echo Thao tác này sẽ chạy thử lệnh 'git push --dry-run' để kiểm tra kết nối từ xa.
echo Nếu thông tin đăng nhập hết hạn hoặc chưa lưu, hộp thoại xác thực của Git sẽ xuất hiện.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "^
$configPath = '.\config.json';^
if (Test-Path $configPath) {^
    $cfg = Get-Content $configPath | ConvertFrom-Json;^
    $roots = $cfg.monitoredRoots;^
    foreach ($r in $roots) {^
        if (Test-Path (Join-Path $r '.git')) {^
            Write-Host \"`n==================================================\";^
            Write-Host \"Kiểm tra Repo: $r\";^
            $remotes = Invoke-Expression \"cmd.exe /c 'cd /d `\"$r`\" && git remote -v'\";^
            if (-not $remotes) {^
                Write-Host '[!] Repository này chưa cấu hình remote origin. Bỏ qua.';^
                continue;^
            }^
            Write-Host 'Đang thực hiện chạy thử Git Push...';^
            $pushRes = cmd.exe /c \"cd /d `\"$r`\" && git push --dry-run origin 2>&1\";^
            if ($LASTEXITCODE -eq 0) {^
                Write-Host '[+] Kết nối và xác thực tới Remote thành công!';^
            } else {^
                Write-Host '[!] Thử push thất bại. Có thể cần đăng nhập hoặc sửa quyền ghi.';^
            }^
        }^
    }^
} else {^
    Write-Host '[!] Không tìm thấy file config.json.';^
}"
echo.
pause
goto MENU

:VIEW_LOGS
echo.
echo === [7] XEM NHẬT KÝ HOẠT ĐỘNG ===
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "^
$logPath = 'E:\git_auto_sync_service\sync.log';^
if (-not (Test-Path $logPath)) {^
    $logPath = '.\sync.log';^
}^
if (Test-Path $logPath) {^
    Write-Host \"15 dòng nhật ký hoạt động gần nhất từ $logPath:`n\";^
    Get-Content $logPath -Tail 15;^
} else {^
    Write-Host '[!] Không tìm thấy tệp nhật ký sync.log.';^
}"
echo.
pause
goto MENU

:EXIT
echo Cảm ơn bạn đã sử dụng Trình Khắc Phục Sự Cố Git Auto-Sync.
exit
