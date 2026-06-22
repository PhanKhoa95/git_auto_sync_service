function Show-Menu {
    Clear-Host
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "      Trinh Khac Phuc Su Co Git Auto-Sync (Autopilot)" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "[1] Kiem tra trang thai dich vu (Daemon Status)"
    Write-Host "[2] Kiem tra ket noi mang (Internet & GitHub)"
    Write-Host "[3] Kiem tra & Cau hinh danh tinh Git (User Name/Email)"
    Write-Host "[4] Kiem tra & Bat Trinh quan ly Dang nhap (GCM Helper)"
    Write-Host "[5] Kiem tra & Sua quyen bao mat thu muc (safe.directory)"
    Write-Host "[6] Thu ket noi tu xa & Dang nhap (Git Push dry-run)"
    Write-Host "[7] Dang xuat / Xoa tai khoan GitHub dang luu (Sign out)"
    Write-Host "[8] Xem nhat ky hoat dong (15 dong log gan nhat)"
    Write-Host "[9] Thoat"
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
}

$choice = ""
while ($choice -ne "9") {
    Show-Menu
    $choice = Read-Host "Chon mot tuy chon (1-9)"
    
    switch ($choice) {
        "1" {
            Write-Host "`n=== [1] KIEM TRA TRANG THAI DICH VU ===" -ForegroundColor Yellow
            $netstat = netstat -ano | Select-String "9999" | Select-String "LISTENING"
            if ($netstat) {
                Write-Host "[+] Dich vu Web Dashboard dang chay tren cong 9999." -ForegroundColor Green
            } else {
                Write-Host "[!] Dich vu Web Dashboard (cong 9999) dang TAT." -ForegroundColor Red
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
                        Write-Host "[+] Tim thay file khoa tai $lockFile voi PID $pid."
                        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                        if ($proc) {
                            Write-Host "[+] Dich vu Daemon (PID $pid) dang HOAT DONG thuc te." -ForegroundColor Green
                        } else {
                            Write-Host "[!] File khoa ton tai nhung tien trinh (PID $pid) da BI TAT." -ForegroundColor Red
                        }
                    } else {
                        Write-Host "[!] Khong tim thay file khoa tai $r." -ForegroundColor Red
                    }
                }
            } else {
                Write-Host "[!] Khong tim thay file config.json." -ForegroundColor Red
            }
            Write-Host "`nNhan Enter de tiep tuc..."
            Read-Host | Out-Null
        }
        "2" {
            Write-Host "`n=== [2] KIEM TRA KET NOI MANG ===" -ForegroundColor Yellow
            Write-Host "Dang gui goi tin kiem tra ket noi toi github.com..."
            $ping = Test-Connection -ComputerName github.com -Count 3 -Quiet -ErrorAction SilentlyContinue
            if ($ping) {
                Write-Host "[+] Ket noi Internet va GitHub tot." -ForegroundColor Green
            } else {
                Write-Host "[!] KHONG THE ket noi toi github.com. Vui lau kiem tra lai duong truyen mang." -ForegroundColor Red
            }
            Write-Host "`nNhan Enter de tiep tuc..."
            Read-Host | Out-Null
        }
        "3" {
            Write-Host "`n=== [3] KIEM TRA & CAU HINH DANH TINH GIT ===" -ForegroundColor Yellow
            $name = git config --global user.name
            $email = git config --global user.email
            Write-Host "Danh tinh Git hien tai:"
            Write-Host "  - Ten nguoi dung: $(if ($name) { $name } else { '[CHUA CAU HINH]' })"
            Write-Host "  - Email:          $(if ($email) { $email } else { '[CHUA CAU HINH]' })"
            Write-Host ""
            $ans = Read-Host "Ban co muon cau hinh / thay doi thong tin nay khong? (Y/N)"
            if ($ans -eq 'Y' -or $ans -eq 'y') {
                $newName = Read-Host "Nhap Git User Name moi"
                $newEmail = Read-Host "Nhap Git Email moi"
                if ($newName) {
                    git config --global user.name $newName
                }
                if ($newEmail) {
                    git config --global user.email $newEmail
                }
                Write-Host "[+] Cap nhat cau hinh Git thanh cong!" -ForegroundColor Green
            }
            Write-Host "`nNhan Enter de tiep tuc..."
            Read-Host | Out-Null
        }
        "4" {
            Write-Host "`n=== [4] KIEM TRA & BAT TRINH QUAN LY DANG NHAP ===" -ForegroundColor Yellow
            $gcm = git config --global credential.helper
            Write-Host "Trinh quan ly dang nhap hien tai: $(if ($gcm) { $gcm } else { '(Chua co)' })"
            if ($gcm -ne 'manager') {
                Write-Host "[!] Git Credential Manager (GCM) chua duoc bat." -ForegroundColor Red
                $ans = Read-Host "Ban co muon kich hoat Git Credential Manager (manager) khong? (Y/N)"
                if ($ans -eq 'Y' -or $ans -eq 'y') {
                    git config --global credential.helper manager
                    Write-Host "[+] Da kich hoat thanh cong Git Credential Manager toan cuc." -ForegroundColor Green
                }
            } else {
                Write-Host "[+] Git Credential Manager da duoc cau hinh chinh xac." -ForegroundColor Green
            }
            Write-Host "`nNhan Enter de tiep tuc..."
            Read-Host | Out-Null
        }
        "5" {
            Write-Host "`n=== [5] KIEM TRA & SUA QUYEN BAO MAT THU MUC ===" -ForegroundColor Yellow
            $safeDirs = git config --global --get-all safe.directory 2>$null
            Write-Host "Danh sach safe.directory hien tai:"
            if ($safeDirs) {
                foreach ($d in $safeDirs) { Write-Host "  - $d" }
            } else {
                Write-Host "  (Trong)"
            }
            $configPath = Join-Path $PSScriptRoot "config.json"
            if (Test-Path $configPath) {
                $cfg = Get-Content $configPath | ConvertFrom-Json
                $roots = $cfg.monitoredRoots
                foreach ($r in $roots) {
                    $resolved = (Resolve-Path $r).Path.Replace('\','/')
                    Write-Host "`nDang kiem tra bao mat thu muc: $resolved"
                    $isSafe = $false
                    if ($safeDirs) {
                        foreach ($sd in $safeDirs) {
                            if ($sd -eq '*' -or $sd -eq $resolved -or $sd.Replace('\','/') -eq $resolved) { $isSafe = $true; break }
                        }
                    }
                    if ($isSafe) {
                        Write-Host "[+] Thu muc $r da an toan." -ForegroundColor Green
                    } else {
                        Write-Host "[!] Thu muc $r CHUA duoc them vao safe.directory cua Git." -ForegroundColor Red
                        $ans = Read-Host "Ban co muon them thu muc nay vao danh sach an toan khong? (Y/N)"
                        if ($ans -eq 'Y' -or $ans -eq 'y') {
                            git config --global --add safe.directory $resolved
                            Write-Host "[+] Da them $resolved vao safe.directory." -ForegroundColor Green
                        }
                    }
                }
            } else {
                Write-Host "[!] Khong tim thay file config.json." -ForegroundColor Red
            }
            Write-Host "`nNhan Enter de tiep tuc..."
            Read-Host | Out-Null
        }
        "6" {
            Write-Host "`n=== [6] THU KET NOI TU XA & DANG NHAP ===" -ForegroundColor Yellow
            Write-Host "Thao tac nay se chay thu lenh 'git push --dry-run' de kiem tra."
            Write-Host "Neu thong tin dang nhap het han, hop thoai xac thuc se xuat hien."
            Write-Host ""
            $configPath = Join-Path $PSScriptRoot "config.json"
            if (Test-Path $configPath) {
                $cfg = Get-Content $configPath | ConvertFrom-Json
                $roots = $cfg.monitoredRoots
                foreach ($r in $roots) {
                    if (Test-Path (Join-Path $r ".git")) {
                        Write-Host "`n==================================================" -ForegroundColor Cyan
                        Write-Host "Kiem tra Repo: $r"
                        
                        # Use Set-Location / native git instead of Invoke-Expression / cmd
                        $oldLocation = Get-Location
                        Set-Location $r
                        $remotes = git remote -v
                        if (-not $remotes) {
                            Write-Host "[!] Repository nay chua cau hinh remote origin. Bo qua." -ForegroundColor Red
                            Set-Location $oldLocation
                            continue
                        }
                        Write-Host "Dang thuc hien chay thu Git Push..."
                        git push --dry-run origin 2>&1
                        if ($LASTEXITCODE -eq 0) {
                            Write-Host "[+] Ket noi va xac thuc toi Remote thanh cong!" -ForegroundColor Green
                        } else {
                            Write-Host "[!] Thu push that bai. Co the can dang nhap hoac sua quyen ghi." -ForegroundColor Red
                        }
                        Set-Location $oldLocation
                    }
                }
            } else {
                Write-Host "[!] Khong tim thay file config.json." -ForegroundColor Red
            }
            Write-Host "`nNhan Enter de tiep tuc..."
            Read-Host | Out-Null
        }
        "7" {
            Write-Host "`n=== [7] DANG XUAT / XOA TAI KHOAN GITHUB DANG LUU ===" -ForegroundColor Yellow
            Write-Host "Dang xoa cac thong tin dang nhap Github cu..."
            cmdkey /delete:LegacyGeneric:target=git:https://github.com 2>$null | Out-Null
            $gkeys = cmdkey /list | Select-String "git:https://github.com"
            foreach ($gk in $gkeys) {
                if ($gk -match "target=(LegacyGeneric:.*?)$") {
                    $target = $Matches[1]
                    cmdkey /delete:$target 2>$null | Out-Null
                }
            }
            @("protocol=https", "host=github.com", "") | git credential reject
            Write-Host "[+] Da xoa thanh cong thong tin tai khoan Github cu." -ForegroundColor Green
            Write-Host "[+] Lan sau khi thuc hien 'git push' hoac Option 6,"
            Write-Host "    Git se hien thi cua so de dang nhap lai bang tai khoan moi."
            Write-Host "`nNhan Enter de tiep tuc..."
            Read-Host | Out-Null
        }
        "8" {
            Write-Host "`n=== [8] XEM NHAT KY HOAT DONG ===" -ForegroundColor Yellow
            $logPath = "E:\git_auto_sync_service\sync.log"
            if (-not (Test-Path $logPath)) {
                $logPath = Join-Path $PSScriptRoot "sync.log"
            }
            if (Test-Path $logPath) {
                Write-Host "15 dong nhat ky hoat dong gan nhat tu $logPath:`n"
                Get-Content $logPath -Tail 15
            } else {
                Write-Host "[!] Khong tim thay tep nhat ky sync.log." -ForegroundColor Red
            }
            Write-Host "`nNhan Enter de tiep tuc..."
            Read-Host | Out-Null
        }
        "9" {
            Write-Host "`nCam on ban da su dung Trinh Khac Phuc Su Co." -ForegroundColor Green
        }
    }
}
