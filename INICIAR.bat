@echo off
setlocal
cd /d "%~dp0"
title Fishing Chat Game - Teste local
echo Fishing Chat Game 1.0.0
echo Pasta do projeto: %CD%
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 24 pelo site nodejs.org.
  echo Depois feche esta janela e abra INICIAR.bat novamente.
  pause
  exit /b 1
)
if not exist "package.json" (
  echo Extraia o ZIP inteiro antes de iniciar. Nao abra este arquivo dentro do ZIP.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Instalando dependencias. A primeira vez pode demorar alguns minutos...
  call npm.cmd install
  if errorlevel 1 (
    echo A instalacao falhou. Envie o erro desta janela para o Codex.
    pause
    exit /b 1
  )
)
echo Abrindo o aplicativo. Mantenha esta janela aberta durante o teste.
call npm.cmd start
if errorlevel 1 (
  echo O aplicativo nao iniciou. Feche outras copias e envie o erro ao Codex.
  pause
)
endlocal
