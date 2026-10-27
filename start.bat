@echo off
REM ============================================================
REM  PropFinder - one-click start for Windows
REM  Double-click this file, or run: start.bat
REM ============================================================
cd /d "%~dp0"
echo.
echo ==== PropFinder setup ====
echo.

REM --- backend ---
if not exist "server\node_modules" (
  echo Installing backend dependencies ^(first run only^)...
  pushd server && call npm install && popd
)
if not exist "server\.env" (
  echo Creating server\.env from example...
  copy "server\.env.example" "server\.env" >nul
)

REM --- frontend ---
if not exist "client\node_modules" (
  echo Installing frontend dependencies ^(first run only^)...
  pushd client && call npm install && popd
)

echo.
echo Starting servers in two new windows...
start "PropFinder API"  cmd /k "cd /d "%~dp0server" && npm run dev"
start "PropFinder Web"  cmd /k "cd /d "%~dp0client" && npm run dev"

echo.
echo ------------------------------------------------------------
echo  Two windows just opened:
echo    - "PropFinder API"  -> http://localhost:5000
echo    - "PropFinder Web"  -> http://localhost:5173  (open this one)
echo.
echo  Wait until the Web window prints:  Local:  http://localhost:5173/
echo  then open that address in your browser.
echo.
echo  Demo login:  agent@propfinder.in  /  Passw0rd!
echo ------------------------------------------------------------
echo.
pause
