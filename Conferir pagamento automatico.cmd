@echo off
chcp 65001 >nul
title Conferir pagamento automatico
cd /d "%~dp0"
node "conferir-pagamento.mjs"
echo.
pause
