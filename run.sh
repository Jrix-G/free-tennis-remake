#!/bin/sh
# Lance Free Tennis (Linux / macOS). Aucune dépendance hors Python 3.8+.
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then PY=python3; elif command -v python >/dev/null 2>&1; then PY=python; else
  echo "Python 3 introuvable : installez-le depuis https://www.python.org/downloads/"; exit 1; fi
exec "$PY" tennis.py "$@"
