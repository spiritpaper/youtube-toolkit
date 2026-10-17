@echo off
rem Double-click to update this YT Toolkit folder to the latest release.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" "%~dp0.."
pause
