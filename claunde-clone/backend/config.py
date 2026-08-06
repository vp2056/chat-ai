"""Configuração da aplicação, lida de variáveis de ambiente."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Lê um .env simples (CHAVE=valor) sem depender de bibliotecas externas."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


_load_dotenv(BASE_DIR / ".env")


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


# Ollama
OLLAMA_HOST = _env("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
OLLAMA_TIMEOUT = float(_env("OLLAMA_TIMEOUT", "600"))
DEFAULT_MODEL = _env("DEFAULT_MODEL", "llama3.2:1b")

# Banco de dados
DB_PATH = Path(_env("DB_PATH", str(BASE_DIR / "data" / "claunde.db")))

# Servidor
HOST = _env("HOST", "0.0.0.0")
PORT = int(_env("PORT", "8000"))

# Front-end estático
FRONTEND_DIR = BASE_DIR / "frontend"

DEFAULT_SYSTEM_PROMPT = _env(
    "DEFAULT_SYSTEM_PROMPT",
    "Você é Claunde, um assistente de IA prestativo, honesto e direto. "
    "Responda em Markdown quando isso melhorar a legibilidade e use blocos de "
    "código com a linguagem indicada. Responda no idioma do usuário.",
)

TITLE_PROMPT = (
    "Gere um título curto (máximo 6 palavras) que resuma a conversa abaixo. "
    "Responda apenas com o título, sem aspas, sem pontuação final.\n\n"
)
