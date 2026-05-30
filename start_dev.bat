@echo off
echo ========================================================
echo    StockVault Local Dev Server
echo ========================================================
echo.
echo Building the frontend assets (Vite)...
call npm run build
echo.
echo Starting Wrangler Pages dev server with local D1 database...
npx wrangler pages dev
pause
