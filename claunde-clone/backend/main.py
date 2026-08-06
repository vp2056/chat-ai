"""Claunde — clone do Claude Chat rodando 100% local sobre Ollama + SQLite."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .routers import chats, system

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("claunde")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    log.info("Banco pronto em %s", config.DB_PATH)
    log.info("Ollama configurado em %s", config.OLLAMA_HOST)
    yield


app = FastAPI(
    title="Claunde API",
    description="Back-end local de chat com IA sobre Ollama.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(chats.router)


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(config.FRONTEND_DIR / "index.html")


if config.FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")


def run() -> None:
    import uvicorn

    uvicorn.run("backend.main:app", host=config.HOST, port=config.PORT, reload=False)


if __name__ == "__main__":
    run()
