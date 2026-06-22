# Set console output encoding to UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

function Show-Menu {
    Clear-Host
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "      Trình Khắc Phục Sự Cố Git Auto-Sync (Autopilot)" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[1] Kiểm tra trạng thái dịch vụ (Daemon Status)"
    Write-Host "[2] Kiểm tra kết nối mạng (Internet & GitHub)"
    Write-Host "[3] Kiểm tra & Cấu hình danh tính Git (User Name/Email)"
    Write-Host "[4] Kiểm tra & Bật Trình quản lý Đăng nhập (GCM Helper)"
    Write-Host "[5] Kiểm tra & Sửa quyền bảo mật thư mục (safe.directory)"
    Write-Host "[6] Thử kết nối từ xa & Đăng nhập (Git Push dry-run)"
    Write-Host "[7] Đăng xuất / Xóa tài khoản GitHub đang lưu (Sign out)"
    Write-Host "[8] Xem nhật ký hoạt động (15 dòng log gần nhất)"
    Write-Host "[9] Thoát"
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
}

$choice = ""
while ($choice -ne "9") {
    Show-Menu
    $choice = Read-Host "Chọn một tùy chọn (1-9)"
    
    switch ($choice) {
        "1" {
            Write-Host "`n=== [1] KIỂM TRA TRẠNG THÁI DỊCH VỤ ===" -ForegroundColor Yellow
            # Check port 9999
            $netstat = netstat -ano | Select-String "9999" | Select-String "LISTENING"
            if ($netstat) {
                Write-Host "[+] Dịch vụ Web Dashboard đang chạy trên cổng 9999." -ForegroundColor Green
            } else {
                Write-Host "[!] Dịch vụ Web Dashboard (cổng 9999) đang TẮT." -ForegroundColor Red
            }
            
            $configPath = Join-Path $PSScriptRoot "config.json"
            if (Test-Path $configPath) {
                $cfg = Get-Content $configPath | ConvertFrom-Json
                $roots = $cfg.monitoredRoots
                Write-Host "Monitored Roots: $($roots -join ', ')"
                foreach ($r in $roots) {
                    $lockFile = Join-Path $r ".sync.lock"
                    if (Test-Path $lockFile) {
                        $pid = (Get-Content $lockFile).Trim()
                        Write-Host "[+] Tìm thấy file khóa tại $lockFile với PID $pid."
                        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                        if ($proc) {
                            Write-Host "[+] Dịch vụ Daemon (PID $pid) đang HOẠT ĐỘNG thực tế." -ForegroundColor Green
                        } else {
                            Write-Host "[!] File khóa tồn tại nhưng tiến trình (PID $pid) đã BỊ TẮT hoặc chết lâm sàng." -ForegroundColor Red
                        }
                    } else {
                        Write-Host "[!] Không tìm thấy file khóa tại $r." -ForegroundColor Red
                    }
                }
            } else {
                Write-Host "[!] Không tìm thấy file config.json ở thư mục gốc." -ForegroundColor Red
            }
            Write-Host "`nNhấn Enter để tiếp tục..."
            Read-Host
        }
        "2" {
            Write-Host "`n=== [2] KIỂM TRA KẾT NỐI MẠNG ===" -ForegroundColor Yellow
            Write-Host "Đang gửi gói tin kiểm tra kết nối tới github.com..."
            $ping = Test-Connection -ComputerName github.com -Count 3 -Quiet -ErrorAction SilentlyContinue
            if ($ping) {
                Write-Host "[+] Kết nối Internet và GitHub tốt." -ForegroundColor Green
            } else {
                Write-Host "[!] KHÔNG THỂ kết nối tới github.com. Vui lòng kiểm tra lại đường truyền mạng của bạn." -ForegroundColor Red
            }
            Write-Host "`nNhấn Enter để tiếp tục..."
            Read-Host
        }
        "3" {
            Write-Host "`n=== [3] KIỂM TRA & CẤU HÌNH DANH TÍNH GIT ===" -ForegroundColor Yellow
            $name = git config --global user.name
            $email = git config --global user.email
            Write-Host "Danh tính Git hiện tại:"
            Write-Host "  - Tên người dùng: $(if ($name) { $name } else { '[CHƯA CẤU HÌNH]' })"
            Write-Host "  - Email:          $(if ($email) { $email } else { '[CHƯA CẤU HÌNH]' })"
            Write-Host ""
            $ans = Read-Host "Bạn có muốn cấu hình / thay đổi thông tin này không? (Y/N)"
            if ($ans -eq 'Y' -or $ans -eq 'y') {
                $newName = Read-Host "Nhập Git User Name mới"
                $newEmail = Read-Host "Nhập Git Email mới"
                if ($newName) {
                    git config --global user.name $newName
                }
                if ($newEmail) {
                    git config --global user.email $newEmail
                }
                Write-Host "[+] Cập nhật cấu hình Git thành công!" -ForegroundColor Green
            }
            Write-Host "`nNhấn Enter để tiếp tục..."
            Read-Host
        }
        "4" {
            Write-Host "`n=== [4] KIỂM TRA & BẬT TRÌNH QUẢN LÝ ĐĂNG NHẬP ===" -ForegroundColor Yellow
            $gcm = git config --global credential.helper
            Write-Host "Trình quản lý đăng nhập hiện tại: $(if ($gcm) { $gcm } else { '(Chưa có)' })"
            if ($gcm -ne 'manager') {
                Write-Host "[!] Git Credential Manager (GCM) chưa được bật hoặc dùng giá trị khác." -ForegroundColor Red
                $ans = Read-Host "Bạn có muốn kích hoạt Git Credential Manager (manager) không? (Y/N)"
                if ($ans -eq 'Y' -or $ans -eq 'y') {
                    git config --global credential.helper manager
                    Write-Host "[+] Đã kích hoạt thành công Git Credential Manager toàn cục." -ForegroundColor Green
                }
            } else {
                Write-Host "[+] Git Credential Manager đã được cấu hình chính xác (credential.helper = manager)." -ForegroundColor Green
            }
            Write-Host "`nNhấn Enter để tiếp tục..."
            Read-Host
        }
        "5" {
            Write-Host "`n=== [5] KIỂM TRA & SỬA QUYỀN BẢO MẬT THƯ MỤC ===" -ForegroundColor Yellow
            $safeDirs = git config --global --get-all safe.directory 2>$null
            Write-Host "Danh sách safe.directory hiện tại:"
            if ($safeDirs) {
                foreach ($d in $safeDirs) { Write-Host "  - $d" }
            } else {
                Write-Host "  (Trống)"
            }
            $configPath = Join-Path $PSScriptRoot "config.json"
            if (Test-Path $configPath) {
                $cfg = Get-Content $configPath | ConvertFrom-Json
                $roots = $cfg.monitoredRoots
                foreach ($r in $roots) {
                    $resolved = (Resolve-Path $r).Path.Replace('\','/')
                    Write-Host "`nĐang kiểm tra bảo mật thư mục: $resolved"
                    $isSafe = $false
                    if ($safeDirs) {
                        foreach ($sd in $safeDirs) {
                            if ($sd -eq '*' -or $sd -eq $resolved -or $sd.Replace('\','/') -eq $resolved) { $isSafe = $true; break }
                        }
                    }
                    if ($isSafe) {
                        Write-Host "[+] Thư mục $r đã an toàn." -ForegroundColor Green
                    } else {
                        Write-Host "[!] Thư mục $r CHƯA được thêm vào safe.directory của Git." -ForegroundColor Red
                        $ans = Read-Host "Bạn có muốn thêm thư mục này vào danh sách an toàn không? (Y/N)"
                        if ($ans -eq 'Y' -or $ans -eq 'y') {
                            git config --global --add safe.directory $resolved
                            Write-Host "[+] Đã thêm $resolved vào safe.directory." -ForegroundColor Green
                        }
                    }
                }
            } else {
                Write-Host "[!] Không tìm thấy file config.json." -ForegroundColor Red
            }
            Write-Host "`nNhấn Enter để tiếp tục..."
            Read-Host
        }
        "6" {
            Write-Host "`n=== [6] THỬ KẾT NỐI TỪ XA & ĐĂNG NHẬP ===" -ForegroundColor Yellow
            Write-Host "Thao tác này sẽ chạy thử lệnh 'git push --dry-run' để kiểm tra kết nối từ xa."
            Write-Host "Nếu thông tin đăng nhập hết hạn hoặc chưa lưu, hộp thoại xác thực của Git sẽ xuất hiện."
            Write-Host ""
            $configPath = Join-Path $PSScriptRoot "config.json"
            if (Test-Path $configPath) {
                $cfg = Get-Content $configPath | ConvertFrom-Json
                $roots = $cfg.monitoredRoots
                foreach ($r in $roots) {
                    if (Test-Path (Join-Path $r ".git")) {
                        Write-Host "`n==================================================" -ForegroundColor Cyan
                        Write-Host "Kiểm tra Repo: $r"
                        $remotes = Invoke-Expression "cmd.exe /c 'cd /d `"$r`" && git remote -v'"
                        if (-not $remotes) {
                            Write-Host "[!] Repository này chưa cấu hình remote origin. Bỏ qua." -ForegroundColor Red
                            continue
                        }
                        Write-Host "Đang thực hiện chạy thử Git Push..."
                        cmd.exe /c "cd /d `"$r`" && git push --dry-run origin 2>&1"
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "[+] Kết nối và xác thực tới Remote thành công!" -ForegroundColor Green
                        } else {
                            Write-Host "[!] Thử push thất bại. Có thể cần đăng nhập hoặc sửa quyền ghi." -ForegroundColor Red
                        }
                    }
                }
            } else {
                Write-Host "[!] Không tìm thấy file config.json." -ForegroundColor Red
            }
            Write-Host "`nNhấn Enter để tiếp tục..."
            Read-Host
        }
        "7" {
            Write-Host "`n=== [7] ĐĂNG XUẤT / XÓA TÀI KHOẢN GITHUB ĐANG LƯU ===" -ForegroundColor Yellow
            Write-Host "Đang xóa các thông tin đăng nhập Github cũ đã lưu..."
            # 1. Delete target target=git:https://github.com
            cmdkey /delete:LegacyGeneric:target=git:https://github.com 2>$null | Out-Null
            # 2. Delete GCM targets matching git:https://github.com
            $gkeys = cmdkey /list | Select-String "git:https://github.com"
            foreach ($gk in $gkeys) {
                if ($gk -match "target=(LegacyGeneric:.*?)$") {
                    $target = $Matches[1]
                    cmdkey /delete:$target 2>$null | Out-Null
                }
            }
            # 3. Reject git credentials
            @("protocol=https", "host=github.com", "") | git credential reject
            Write-Host "[+] Đã xóa thành công thông tin tài khoản Github cũ (ví dụ: khoap1220-hue)." -ForegroundColor Green
            Write-Host "[+] Lần sau khi bạn thực hiện 'git push' hoặc chạy Tùy chọn 6,"
            Write-Host "    Git sẽ hiển thị cửa sổ để bạn đăng nhập lại bằng tài khoản mới."
            Write-Host "`nNhấn Enter để tiếp tục..."
            Read-Host
        }
        "8" {
            Write-Host "`n=== [8] XEM NHẬT KÝ HOẠT ĐỘNG ===" -ForegroundColor Yellow
            $logPath = "E:\git_auto_sync_service\sync.log"
            if (-not (Test-Path $logPath)) {
                $logPath = Join-Path $PSScriptRoot "sync.log"
            }
            if (Test-Path $logPath) {
                Write-Host "15 dòng nhật ký hoạt động gần nhất từ $logPath:`n"
                Get-Content $logPath -Tail 15
            } else {
                Write-Host "[!] Không tìm thấy tệp nhật ký sync.log." -ForegroundColor Red
            }
            Write-Host "`nNhấn Enter để tiếp tục..."
            Read-Host
        }
        "9" {
            Write-Host "`nCảm ơn bạn đã sử dụng Trình Khắc Phục Sự Cố Git Auto-Sync." -ForegroundColor Green
        }
    }
}
