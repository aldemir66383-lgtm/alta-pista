@echo off
chcp 65001 >nul
title Dar acesso ao Painel
cd /d "%~dp0"
node "dar-acesso.mjs"
echo.
pause
