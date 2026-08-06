"""Endpoints de conversas, mensagens e streaming de respostas."""
import json
from typing import AsyncIterator, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, StreamingResponse

from .. import config, db, ollama
from ..schemas import ChatCreate, ChatUpdate, EditMessage, Regenerate, SendMessage

router = APIRouter(prefix="/api/chats", tags=["chats"])


def _default_model() -> str:
    return db.get_setting("default_model", config.DEFAULT_MODEL)


def _default_system() -> str:
    return db.get_setting("system_prompt", config.DEFAULT_SYSTEM_PROMPT)


def _default_options() -> dict:
    return db.get_setting("options", {}) or {}


def _require_chat(chat_id: str) -> dict:
    chat = db.get_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Conversa não encontrada")
    return chat


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# --------------------------------------------------------------------------- #
# CRUD de conversas
# --------------------------------------------------------------------------- #
@router.get("")
def list_chats(archived: bool = False, q: Optional[str] = Query(default=None)):
    return db.list_chats(archived=archived, query=q)


@router.post("", status_code=201)
def create_chat(payload: ChatCreate):
    return db.create_chat(
        title=payload.title or "Nova conversa",
        model=payload.model or _default_model(),
        system_prompt=payload.system_prompt if payload.system_prompt is not None else _default_system(),
    )


@router.get("/{chat_id}")
def get_chat(chat_id: str):
    chat = _require_chat(chat_id)
    chat["messages"] = db.list_messages(chat_id)
    return chat


@router.patch("/{chat_id}")
def update_chat(chat_id: str, payload: ChatUpdate):
    _require_chat(chat_id)
    return db.update_chat(chat_id, **payload.model_dump(exclude_unset=True))


@router.delete("/{chat_id}", status_code=204)
def delete_chat(chat_id: str):
    if not db.delete_chat(chat_id):
        raise HTTPException(status_code=404, detail="Conversa não encontrada")


@router.get("/{chat_id}/messages")
def list_messages(chat_id: str):
    _require_chat(chat_id)
    return db.list_messages(chat_id)


@router.delete("/{chat_id}/messages/{message_id}", status_code=204)
def delete_message(chat_id: str, message_id: str):
    _require_chat(chat_id)
    if not db.delete_message(message_id):
        raise HTTPException(status_code=404, detail="Mensagem não encontrada")


@router.get("/{chat_id}/export")
def export_chat(chat_id: str, fmt: str = Query(default="markdown", pattern="^(markdown|json)$")):
    chat = _require_chat(chat_id)
    messages = db.list_messages(chat_id)
    if fmt == "json":
        return {**chat, "messages": messages}

    lines = [f"# {chat['title']}", "", f"*Modelo: {chat['model']}*", ""]
    for msg in messages:
        who = "Você" if msg["role"] == "user" else "Claunde"
        lines += [f"## {who}", "", msg["content"], ""]
    return PlainTextResponse(
        "\n".join(lines),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{chat_id}.md"'},
    )


# --------------------------------------------------------------------------- #
# Conversa com o modelo
# --------------------------------------------------------------------------- #
def _build_context(chat: dict, system_prompt: Optional[str], history_limit: int) -> list[dict]:
    """Monta o payload de mensagens para o Ollama, com a janela de histórico."""
    system = system_prompt or chat.get("system_prompt") or _default_system()
    context = [{"role": "system", "content": system}] if system else []
    history = db.list_messages(chat["id"])
    for msg in history[-history_limit:]:
        if msg["role"] == "system" or msg["error"]:
            continue
        content = (msg["content"] or "").strip()
        if content:
            context.append({"role": msg["role"], "content": content})
    return context


async def _stream_completion(
    request: Request,
    chat: dict,
    model: str,
    context: list[dict],
    options: dict,
    make_title: bool,
) -> AsyncIterator[str]:
    """Gera SSE: token → delta, fim → done, falha → error."""
    assistant = db.add_message(chat["id"], "assistant", content="", model=model)
    yield _sse("start", {"message_id": assistant["id"], "model": model})

    buffer: list[str] = []
    thinking: list[str] = []
    stats: dict = {}
    error: Optional[str] = None

    def persist() -> str:
        """Grava o que foi gerado até agora. Chamado também se o cliente sumir."""
        text = "".join(buffer)
        db.update_message(
            assistant["id"],
            content=text,
            thinking="".join(thinking) or None,
            error=error,
            stats=stats or None,
        )
        return text

    try:
        async for chunk in ollama.chat_stream(model, context, options):
            if await request.is_disconnected():
                break

            message = chunk.get("message") or {}
            token = message.get("content") or ""
            reasoning = message.get("thinking") or ""

            if reasoning:
                thinking.append(reasoning)
                yield _sse("thinking", {"delta": reasoning})
            if token:
                buffer.append(token)
                yield _sse("delta", {"delta": token})

            if chunk.get("done"):
                total_ns = chunk.get("total_duration") or 0
                eval_count = chunk.get("eval_count") or 0
                eval_ns = chunk.get("eval_duration") or 0
                stats = {
                    "eval_count": eval_count,
                    "prompt_eval_count": chunk.get("prompt_eval_count") or 0,
                    "total_ms": round(total_ns / 1e6),
                    "tokens_per_second": round(eval_count / (eval_ns / 1e9), 1) if eval_ns else None,
                }
    except ollama.OllamaError as exc:
        error = str(exc)
    except Exception as exc:  # noqa: BLE001 — nunca deixa o stream morrer sem aviso
        error = f"Erro inesperado: {exc}"
    finally:
        # Roda também em GeneratorExit/CancelledError (aba fechada, botão Parar),
        # que é como o servidor encerra o gerador — por isso não basta um except.
        content = persist()

    if error:
        yield _sse("error", {"message_id": assistant["id"], "error": error})
        return

    # "done" primeiro: a interface volta ao normal sem esperar pelo título.
    yield _sse("done", {"message_id": assistant["id"], "content": content, "stats": stats})

    if make_title and content.strip():
        user_text = next((m["content"] for m in context if m["role"] == "user"), "")
        conversation = f"Usuário: {user_text[:600]}\nAssistente: {content[:600]}"
        title = await ollama.generate_title(model, conversation)
        if title:
            db.update_chat(chat["id"], title=title)
            yield _sse("title", {"chat_id": chat["id"], "title": title})


def _sse_response(generator: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.post("/{chat_id}/messages")
async def send_message(chat_id: str, payload: SendMessage, request: Request):
    """Grava a mensagem do usuário e transmite a resposta do modelo via SSE."""
    chat = _require_chat(chat_id)
    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Mensagem vazia")

    model = payload.model or chat["model"] or _default_model()
    if model != chat["model"]:
        db.update_chat(chat_id, model=model)

    is_first = chat["message_count"] == 0
    db.add_message(chat_id, "user", content)

    context = _build_context(chat, payload.system_prompt, payload.history_limit)
    options = {**_default_options(), **(payload.options.model_dump(exclude_none=True) if payload.options else {})}

    auto_title = bool(db.get_setting("auto_title", True))
    return _sse_response(
        _stream_completion(request, chat, model, context, options, make_title=is_first and auto_title)
    )


@router.post("/{chat_id}/regenerate")
async def regenerate(chat_id: str, payload: Regenerate, request: Request):
    """Descarta a última resposta (ou a indicada) e gera outra."""
    chat = _require_chat(chat_id)
    messages = db.list_messages(chat_id)
    if not messages:
        raise HTTPException(status_code=400, detail="Não há nada para regenerar")

    target = payload.message_id
    if target is None:
        target = next((m["id"] for m in reversed(messages) if m["role"] == "assistant"), None)
    if target is None:
        raise HTTPException(status_code=400, detail="Nenhuma resposta do assistente encontrada")

    db.delete_messages_from(chat_id, target)

    model = payload.model or chat["model"] or _default_model()
    context = _build_context(chat, None, payload.history_limit)
    if not any(m["role"] == "user" for m in context):
        raise HTTPException(status_code=400, detail="Não há mensagem do usuário para responder")

    options = {**_default_options(), **(payload.options.model_dump(exclude_none=True) if payload.options else {})}
    return _sse_response(
        _stream_completion(request, chat, model, context, options, make_title=False)
    )


@router.post("/{chat_id}/messages/{message_id}/edit")
async def edit_message(chat_id: str, message_id: str, payload: EditMessage, request: Request):
    """Edita uma mensagem do usuário; por padrão apaga o que veio depois e responde de novo."""
    chat = _require_chat(chat_id)
    original = db.get_message(message_id)
    if original is None or original["chat_id"] != chat_id:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada")

    content = payload.content.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Mensagem vazia")

    if not payload.resend:
        return db.update_message(message_id, content=content)

    db.delete_messages_from(chat_id, message_id)
    db.add_message(chat_id, "user", content)

    context = _build_context(chat, None, 40)
    model = chat["model"] or _default_model()
    return _sse_response(
        _stream_completion(request, chat, model, context, _default_options(), make_title=False)
    )
