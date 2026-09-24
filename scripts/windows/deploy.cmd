@echo off
setlocal EnableExtensions

rem ===========================================================================
rem  deploy.cmd
rem  Pull the latest code, run migrations, restart the service.
rem  Run on the SERVER from an Administrator Command Prompt.
rem ===========================================================================

set "APP_DIR=C:\www\apps\complaint-app"
set "SVC=ComplaintApp"

net session >nul 2>&1
if errorlevel 1 (
  echo This window is not running as Administrator.
  goto :fail
)

pushd "%APP_DIR%" || goto :fail

echo [1/5] Stopping service...
nssm stop "%SVC%"

echo [2/5] Pulling latest code...
call git pull
if errorlevel 1 goto :restart_and_fail

echo [3/5] Installing dependencies...
call npm ci
if errorlevel 1 goto :restart_and_fail

echo [4/5] Running migrations...
call npm run db:migrate
if errorlevel 1 goto :restart_and_fail

echo [5/5] Starting service...
nssm start "%SVC%"
timeout /t 6 /nobreak >nul
nssm status "%SVC%"
popd
endlocal
exit /b 0

:restart_and_fail
echo.
echo A step failed. Restarting the service with the code that is on disk now.
nssm start "%SVC%"
nssm status "%SVC%"
popd

:fail
echo.
echo Deploy did not complete. Check the output above.
endlocal
exit /b 1
