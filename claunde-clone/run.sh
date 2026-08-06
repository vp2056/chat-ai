#!/usr/bin/env bash
# Sobe o Claunde localmente (sem Docker).
set -euo pipefail
cd "$(dirname "$0")"

PY=python3
if [ -d .venv ]; then PY=.venv/bin/python; fi

if ! "$PY" -c "import fastapi, httpx, uvicorn" 2>/dev/null; then
  echo "Instalando dependências…"
  "$PY" -m pip install -r requirements.txt
fi

if ! curl -sf -m 2 "${OLLAMA_HOST:-http://localhost:11434}/api/version" >/dev/null; then
  echo "AVISO: Ollama não respondeu em ${OLLAMA_HOST:-http://localhost:11434}."
  echo "       Inicie com: ollama serve"
fi

echo "Claunde em http://localhost:${PORT:-8000}"
exec "$PY" -m uvicorn backend.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}"
