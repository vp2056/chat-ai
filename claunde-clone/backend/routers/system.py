"""Endpoints de modelos, configurações e saúde do sistema."""
import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from .. import config, db, ollama
from ..schemas import PullRequest, SettingsUpdate

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
async def health():
    ollama_status = await ollama.health()
    return {"status": "ok", "ollama": ollama_status, "database": db.stats()}


@router.get("/models")
async def list_models():
    try:
        models = await ollama.list_models()
    except ollama.OllamaError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"models": models, "default": db.get_setting("default_model", config.DEFAULT_MODEL)}


@router.get("/models/{name:path}/info")
async def model_info(name: str):
    try:
        return await ollama.show_model(name)
    except ollama.OllamaError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/models/pull")
async def pull_model(payload: PullRequest):
    """Baixa um modelo com progresso via SSE (requer internet nesta operação)."""
    async def stream():
        try:
            async for chunk in ollama.pull_model(payload.name):
                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
        except ollama.OllamaError as exc:
            yield f"event: error\ndata: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.delete("/models/{name:path}", status_code=204)
async def delete_model(name: str):
    try:
        await ollama.delete_model(name)
    except ollama.OllamaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/settings")
def get_settings():
    saved = db.all_settings()
    return {
        "default_model": saved.get("default_model", config.DEFAULT_MODEL),
        "system_prompt": saved.get("system_prompt", config.DEFAULT_SYSTEM_PROMPT),
        "options": saved.get("options", {"temperature": 0.7, "top_p": 0.9, "num_ctx": 4096}),
        "theme": saved.get("theme", "dark"),
        "history_limit": saved.get("history_limit", 40),
        "auto_title": saved.get("auto_title", True),
        "send_on_enter": saved.get("send_on_enter", True),
    }


@router.put("/settings")
def update_settings(payload: SettingsUpdate):
    for key, value in payload.values.items():
        db.set_setting(key, value)
    return get_settings()


@router.get("/search")
def search(q: str = Query(min_length=1), limit: int = Query(default=50, ge=1, le=200)):
    return {"results": db.search_messages(q, limit)}


@router.delete("/chats", status_code=200)
def wipe_chats():
    return {"deleted": db.delete_all_chats()}
