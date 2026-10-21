@echo off
rem DeepScient launcher entry point. All logic lives in launch.ps1; this layer
rem only needs to find a PowerShell and forward the arguments unchanged.
rem (ASCII only: cmd.exe reads .cmd files in the OEM code page, so non-ASCII
rem comments here turn into commands.)
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_EXE=pwsh"
where pwsh >nul 2>nul
if errorlevel 1 set "PS_EXE=powershell"

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%launch.ps1" %*
exit /b %ERRORLEVEL%
