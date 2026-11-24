@echo off
powershell.exe -NoProfile -File "%~dp0scripts\m3-start.ps1" -RunId m3-runtime-repair-02 -Port 54654 -IdleSeconds 7200
if errorlevel 1 pause
