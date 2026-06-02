@echo off
echo ========================================================
echo    Cloudflare D1 Database Syncer (Remote -^> Local)
echo ========================================================
echo.
echo 1. Exporting remote D1 database (stockvault-db) to remote_data.sql...
call npx wrangler d1 export stockvault-db --remote --output ./remote_data.sql
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to export remote database!
    echo Please run 'npx wrangler login' first to make sure you are logged in.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo [SUCCESS] Exported successfully to ./remote_data.sql
echo.

set /p CONFIRM=Do you want to import this data into your LOCAL development D1 database? (Y/N): 
if /i "%CONFIRM%" neq "Y" (
    echo Sync cancelled. Exiting...
    pause
    exit /b 0
)

echo.
set /p WIPE=To avoid 'table already exists' conflicts, do you want to WIPE your local D1 cache first? (Highly Recommended) (Y/N): 
if /i "%WIPE%"=="Y" (
    echo Wiping local D1 database files...
    if exist ".wrangler\state\v3\d1\miniflare-D1DatabaseObject" (
        del /q /f /s ".wrangler\state\v3\d1\miniflare-D1DatabaseObject\*.*" >nul 2>&1
        echo Local D1 cache wiped successfully!
    ) else (
        echo Local D1 cache directory not found, skipping wipe.
    )
)

echo.
echo 2. Executing SQL import on LOCAL dev D1 database...
call npx wrangler d1 execute stockvault-db --local --file ./remote_data.sql
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to import into local database.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [SUCCESS] Local database synced successfully!
pause
