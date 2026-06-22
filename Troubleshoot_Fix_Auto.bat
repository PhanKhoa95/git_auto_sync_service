@echo off
:: Set code page to UTF-8 to display Vietnamese correctly
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Troubleshoot_Fix_Auto.ps1"
