@echo off
cd /d "%~dp0"
echo SirDashboard local — http://localhost:5000  et  http://sirdashboard.test
call "%~dp0.venv\Scripts\activate.bat"
python app.py
pause
