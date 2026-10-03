@echo off
REM Lance Free Tennis (Windows). Aucune dependance hors Python 3.8+.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 tennis.py %* & goto :eof)
where python >nul 2>nul && (python tennis.py %* & goto :eof)
echo Python 3 introuvable : installez-le depuis https://www.python.org/downloads/ (cochez "Add to PATH").
pause
