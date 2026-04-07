@echo off
setlocal enabledelayedexpansion

REM === HARD SET WORKING DIRECTORY ===
cd /d "C:\Users\nickv\Documents\code_projects\eaglevents" || exit /b 3

REM === LOGGING SETUP ===
set LOGDIR=C:\Users\nickv\Documents\code_projects\eaglevents\logs
set LOGFILE=%LOGDIR%\service.log

if not exist "%LOGDIR%" (
    mkdir "%LOGDIR%"
)

echo ============================== >> "%LOGFILE%"
echo Service start %date% %time% >> "%LOGFILE%"
echo User: %USERNAME% >> "%LOGFILE%"
echo Working dir: %CD% >> "%LOGFILE%"
echo ============================== >> "%LOGFILE%"

REM === EXPLICIT NODE AND PNPM PATHS ===
set NODE_HOME=C:\Program Files\nodejs
set PATH=%NODE_HOME%;%PATH%

REM === VERIFY TOOLS EXIST ===
where node >> "%LOGFILE%" 2>&1 || exit /b 3
where pnpm >> "%LOGFILE%" 2>&1 || exit /b 3

REM === REUSE EXISTING PRODUCTION ARTIFACTS ===
if exist ".next" (
    echo Using existing .next build output >> "%LOGFILE%"
) else (
    echo Missing .next build output; start-prod.bat will not create a new build >> "%LOGFILE%"
)

REM === START APPLICATION ===
echo Starting production server >> "%LOGFILE%"
pnpm prod start >> "%LOGFILE%" 2>&1

set EXITCODE=%ERRORLEVEL%
echo Exit code: %EXITCODE% >> "%LOGFILE%"

exit /b %EXITCODE%
