@echo off

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed.
    exit /b 1
)
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo npm is not installed.
    exit /b 1
)

call npm install --no-audit
call node server.js %*