@echo off
rem Start hirecute on this computer and open it in the browser.
rem
rem   up.cmd              the scenario split decides (as for a new visitor)
rem   up.cmd recruiter    open one scenario (any file in web\scenarios\)
rem
rem Double-clicking works too. Needs Docker Desktop running. Stop with down.cmd.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set NAME=hirecute-local
set IMAGE=hirecute:local
if "%PORT%"=="" set PORT=8080
set URL=http://127.0.0.1:%PORT%
set ENV_FILE=.env.hirecute.local
set FLOW=%~1

docker info >nul 2>&1
if errorlevel 1 (
  echo ERROR: Docker is not running. Start Docker Desktop, wait until it says it is running, then run up.cmd again.
  goto :fail
)

if not "%FLOW%"=="" if not exist "web\scenarios\%FLOW%.json" (
  echo ERROR: There is no scenario "%FLOW%". Known scenarios:
  for %%f in (web\scenarios\*.json) do echo   %%~nf
  goto :fail
)

if not exist "%ENV_FILE%" (
  copy /y .env.hirecute.example "%ENV_FILE%" >nul
  echo Created %ENV_FILE% and opened it in Notepad.
  echo Paste the model key after HIRECUTE_MODEL_API_KEY= , save, close Notepad and run up.cmd again.
  start "" notepad "%ENV_FILE%"
  goto :fail
)
findstr /r /c:"^HIRECUTE_MODEL_API_KEY=..*" "%ENV_FILE%" >nul
if errorlevel 1 (
  echo ERROR: The model key is empty. Paste it after HIRECUTE_MODEL_API_KEY= in %ENV_FILE% , save and run up.cmd again.
  start "" notepad "%ENV_FILE%"
  goto :fail
)

echo.
echo ==^> Building the app - the first time takes a few minutes, later only changes are rebuilt
docker build -f web/Dockerfile -t %IMAGE% .
if errorlevel 1 goto :fail

echo.
echo ==^> Starting it
docker rm -f %NAME% >nul 2>&1
docker run -d --name %NAME% -p 127.0.0.1:%PORT%:8080 --env-file "%ENV_FILE%" -e HIRECUTE_BASE_URL=%URL% -e CAREER_OPS_WEB_ALLOWED_HOSTS=127.0.0.1 %IMAGE% >nul
if errorlevel 1 goto :fail

echo.
echo ==^> Waiting until it is ready
set /a TRIES=0
:wait
curl -fsS %URL%/health >nul 2>&1
if not errorlevel 1 goto :ready
set RUNNING=
for /f %%s in ('docker inspect -f "{{.State.Running}}" %NAME% 2^>nul') do set RUNNING=%%s
if not "!RUNNING!"=="true" (
  docker logs --tail 40 %NAME%
  echo ERROR: The app stopped while starting - its log is above. A wrong or expired model key is the usual reason.
  goto :fail
)
set /a TRIES+=1
if !TRIES! geq 90 (
  echo ERROR: The app did not become ready in 90 seconds. See: docker logs %NAME%
  goto :fail
)
timeout /t 1 /nobreak >nul
goto :wait

:ready
set OPEN=%URL%/
if not "%FLOW%"=="" set OPEN=%URL%/?t=%FLOW%
echo.
echo ==^> Ready: %OPEN%
echo     Always use this address - 127.0.0.1, not localhost - or uploads are refused.
echo     To switch scenario after a run has started: "Start over", or up.cmd ^<scenario^>.
echo     Stop: down.cmd    Log: docker logs -f %NAME%
start "" "%OPEN%"
echo.
pause
endlocal
exit /b 0

:fail
echo.
pause
endlocal
exit /b 1
