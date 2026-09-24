@echo off
setlocal EnableExtensions

rem ===========================================================================
rem  install-service.cmd
rem  Register the complaint app as a Windows Service using NSSM.
rem
rem  Run this on the SERVER only, from an Administrator Command Prompt.
rem  Do NOT run it on a development machine - use "npm start" there instead.
rem
rem  Messages are in English on purpose: a .cmd file printing Thai text gets
rem  garbled under the default console code page on most Windows Servers.
rem  The Thai explanation lives in docs/WINDOWS_SERVICE.md
rem ===========================================================================

rem ---------------------------------------------------------------------------
rem  1. EDIT THESE FOUR VALUES TO MATCH THIS SERVER
rem ---------------------------------------------------------------------------
set "APP_DIR=C:\www\apps\complaint-app"
set "NODE_EXE=C:\Program Files\nodejs\node.exe"
set "SVC=ComplaintApp"
set "PGSVC=postgresql-x64-18"

rem  Optional settings - the defaults are fine for most installs
set "LOG_DIR=C:\www\logs"
set "APP_PORT=3000"
set "DISPLAY_NAME=Surat Thani Complaint System"

rem ===========================================================================

echo.
echo ================================================
echo  Complaint App - Windows Service installer
echo ================================================
echo.
echo   Service name : %SVC%
echo   App folder   : %APP_DIR%
echo   Node         : %NODE_EXE%
echo   Depends on   : %PGSVC%
echo   Log folder   : %LOG_DIR%
echo   Port         : %APP_PORT%
echo.

rem ---------------------------------------------------------------------------
rem  2. Pre-flight checks - stop early instead of half-installing
rem ---------------------------------------------------------------------------
echo [1/8] Checking administrator rights...
net session >nul 2>&1
if errorlevel 1 (
  echo   FAILED: this window is not running as Administrator.
  echo   Close it, right-click Command Prompt and choose "Run as administrator".
  goto :fail
)
echo   OK

echo [2/8] Checking NSSM...
where nssm >nul 2>&1
if errorlevel 1 (
  echo   FAILED: nssm.exe not found on PATH.
  echo   Download nssm from https://nssm.cc/download and copy
  echo   win64\nssm.exe into C:\Windows\System32\
  goto :fail
)
echo   OK

echo [3/8] Checking Node and app folder...
if not exist "%NODE_EXE%" (
  echo   FAILED: Node not found at %NODE_EXE%
  echo   Run "where node" and put the real path in this file.
  goto :fail
)
if not exist "%APP_DIR%\src\server.js" (
  echo   FAILED: %APP_DIR%\src\server.js does not exist.
  echo   Check APP_DIR at the top of this file.
  goto :fail
)
if not exist "%APP_DIR%\.env" (
  echo   FAILED: %APP_DIR%\.env does not exist.
  echo   The service cannot start without it.
  goto :fail
)
echo   OK

echo [4/8] Checking PostgreSQL service...
sc query "%PGSVC%" >nul 2>&1
if errorlevel 1 (
  echo   FAILED: service "%PGSVC%" not found.
  echo   Run this to find the real name:
  echo       sc query state= all ^| findstr /i postgres
  goto :fail
)
echo   OK

rem ---------------------------------------------------------------------------
rem  3. Refuse to overwrite an existing service by accident
rem ---------------------------------------------------------------------------
sc query "%SVC%" >nul 2>&1
if not errorlevel 1 (
  echo.
  echo   Service "%SVC%" already exists.
  echo   Remove it first with:  nssm remove %SVC% confirm
  goto :fail
)

echo.
set /p CONFIRM="All checks passed. Install the service now? (y/N) "
if /i not "%CONFIRM%"=="y" goto :cancelled

rem ---------------------------------------------------------------------------
rem  4. Database migrations run here, once, not inside the service.
rem     A service that migrates on every start turns a bad migration into a
rem     restart loop that keeps re-running it.
rem ---------------------------------------------------------------------------
echo.
echo [5/8] Running database migrations...
pushd "%APP_DIR%"
call npm run db:migrate
if errorlevel 1 (
  popd
  echo   FAILED: migrations did not complete. Fix them before installing.
  goto :fail
)
popd
echo   OK

rem ---------------------------------------------------------------------------
rem  5. Create the service
rem ---------------------------------------------------------------------------
echo [6/8] Creating service...
nssm install "%SVC%" "%NODE_EXE%" "src\server.js"
if errorlevel 1 goto :fail

nssm set "%SVC%" AppDirectory "%APP_DIR%"
nssm set "%SVC%" DisplayName "%DISPLAY_NAME%"
nssm set "%SVC%" Description "LINE OA citizen complaint system"
nssm set "%SVC%" Start SERVICE_AUTO_START
nssm set "%SVC%" DependOnService "%PGSVC%"

rem  Restart on crash, but throttle so a boot-time failure does not spin
nssm set "%SVC%" AppExit Default Restart
nssm set "%SVC%" AppRestartDelay 5000
nssm set "%SVC%" AppThrottle 10000
echo   OK

echo [7/8] Configuring logs...
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
nssm set "%SVC%" AppStdout "%LOG_DIR%\complaint-out.log"
nssm set "%SVC%" AppStderr "%LOG_DIR%\complaint-err.log"
nssm set "%SVC%" AppRotateFiles 1
nssm set "%SVC%" AppRotateOnline 1
nssm set "%SVC%" AppRotateBytes 10485760
echo   OK

rem ---------------------------------------------------------------------------
rem  6. Start and verify
rem ---------------------------------------------------------------------------
echo [8/8] Starting service...
nssm start "%SVC%"
timeout /t 6 /nobreak >nul
nssm status "%SVC%"

echo.
echo ------------------------------------------------
echo  Listening sockets on port %APP_PORT%:
netstat -ano | findstr :%APP_PORT%
echo.
echo  Error log contents:
if exist "%LOG_DIR%\complaint-err.log" type "%LOG_DIR%\complaint-err.log"
echo ------------------------------------------------
echo.
echo  Done. If the status above is not SERVICE_RUNNING, read
echo  %LOG_DIR%\complaint-err.log - the three usual causes are listed
echo  in docs\WINDOWS_SERVICE.md
echo.
echo  Firewall rule is NOT created by this script. If the app must be
echo  reachable from other machines, run:
echo      netsh advfirewall firewall add rule name="Complaint App" dir=in action=allow protocol=TCP localport=%APP_PORT%
echo.
goto :end

:cancelled
echo.
echo Cancelled. Nothing was changed.
goto :end

:fail
echo.
echo Installation stopped. Nothing was started.
endlocal
exit /b 1

:end
endlocal
exit /b 0
