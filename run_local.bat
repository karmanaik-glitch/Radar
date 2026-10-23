@echo off
cd /d "%~dp0"
echo STRATA preview: http://localhost:8000/app/
start "" http://localhost:8000/app/
python -m http.server 8000
