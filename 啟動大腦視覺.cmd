@echo off
setlocal
powershell.exe -NoProfile -File "%~dp0scripts\m3-start.ps1" -RunId "m3b-file-startup-fix-02" -Port 54654 -IdleSeconds 7200
if errorlevel 1 (
  echo M3B start failed. Keep the error for diagnosis.
  pause
)
endlocal
