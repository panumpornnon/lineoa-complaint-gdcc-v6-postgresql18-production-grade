@echo off
setlocal EnableExtensions

rem ===========================================================================
rem  uninstall-service.cmd
rem  Stop and remove the Windows Service. Code, database and logs are kept.
rem ===========================================================================

set "SVC=ComplaintApp"

net session >nul 2>&1
if errorlevel 1 (
  echo This window is not running as Administrator.
  goto :fail
)

sc query "%SVC%" >nul 2>&1
if errorlevel 1 (
  echo Service "%SVC%" does not exist. Nothing to do.
  goto :end
)

set /p CONFIRM="Remove service %SVC%? The app will stop. (y/N) "
if /i not "%CONFIRM%"=="y" goto :cancelled

nssm stop "%SVC%"
nssm remove "%SVC%" confirm
echo.
echo Removed. Code, database and logs were not touched.
goto :end

:cancelled
echo Cancelled. Nothing was changed.
goto :end

:fail
endlocal
exit /b 1

:end
endlocal
exit /b 0
